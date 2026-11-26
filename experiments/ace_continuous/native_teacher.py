"""Rebuild the frozen CPU Ace teacher with a hardware-sized worker bound."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

from hybrid import native_worker_limit, read, save, reserve_workers

OLD = '''            let workers=v["workers"].as_u64().unwrap_or(8) as usize;
            if workers==0 || workers>8 {return Err("invalid teacher workers".into());}'''
NEW = '''            let limit=std::thread::available_parallelism().map(usize::from).unwrap_or(1);
            let workers=v["workers"].as_u64().unwrap_or(limit as u64) as usize;
            if workers==0 || workers>limit {return Err("invalid teacher workers".into());}'''
RUST_TEST = '''
#[cfg(all(test, feature="ace-benchmark"))]
#[test]
fn teacher_worker_hardware_bound() {
    let mut arenas=Vec::new();
    let limit=std::thread::available_parallelism().map(usize::from).unwrap_or(1);
    for workers in [1, limit] {
        assert_eq!(request(&json!({"kind":"teach","workers":workers,"ids":[]}), &mut arenas).unwrap(), json!({"labels":[]}));
    }
    for workers in [0, limit+1] {
        assert!(request(&json!({"kind":"teach","workers":workers,"ids":[]}), &mut arenas).is_err());
    }
}
'''


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def patch_source(source):
    assert source.count(OLD) == 1, 'Frozen teacher source differs from the reviewed patch'
    return source.replace(OLD, NEW) + RUST_TEST


def build(setup, live):
    setup, live = Path(setup), Path(live)
    original = live.parent / 'model31-ace-teacher-20261102-v1'
    source = original / 'build'
    target = setup / 'source'
    if not (setup / 'source-manifest.json').exists():
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(source, target, ignore=shutil.ignore_patterns('target', '__pycache__'))
        env_file = target / 'experiments/ordered-outcome/env.rs'
        assert env_file.read_bytes() == (original / 'env.rs').read_bytes()
        before = {str(p.relative_to(target)): sha(p) for p in sorted(target.rglob('*')) if p.is_file()}
        env_file.write_text(patch_source(env_file.read_text()))
        after = {str(p.relative_to(target)): sha(p) for p in sorted(target.rglob('*')) if p.is_file()}
        assert [name for name in before if before[name] != after[name]] == ['experiments/ordered-outcome/env.rs']
        save(setup / 'source-manifest.json', dict(original=before, patched=after,
             change='Only teacher worker validation/default and its unit test; frozen rules, Ace policy and assets retained'))
    manifest = read(setup / 'source-manifest.json')
    for name, digest in manifest['patched'].items():
        assert sha(target / name) == digest
    sdk = '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk'
    clt = '/Library/Developer/CommandLineTools/usr/bin'
    env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools', SDKROOT=sdk,
        CC=clt+'/clang', CXX=clt+'/clang++', AR=clt+'/ar',
        CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER=clt+'/clang', CARGO_TARGET_DIR=str(setup / 'cargo-target'),
        RUSTFLAGS='-C link-arg=-isysroot -C link-arg='+sdk, NUM_JOBS='1')
    sys.path.insert(0, str(live / 'model31/source'))
    from resources import one_cpu
    cargo = str(Path.home() / '.cargo/bin/cargo')
    base = ['--offline', '--locked', '--manifest-path', str(target / 'experiments/ordered-outcome/Cargo.toml'), '--features', 'ace-benchmark', '-j', '1']
    quiet = setup / 'run-quiet.sh'
    with one_cpu(setup.name + '-build'):
        subprocess.run(['/bin/bash', str(quiet), '--show-warnings', 'Native teacher CPU limits', cargo, 'test', *base, 'teacher_worker_hardware_bound'], env=env, check=True)
        subprocess.run(['/bin/bash', str(quiet), '--show-warnings', 'Native teacher release', cargo, 'build', '--release', *base], env=env, check=True)
    binary = setup / 'teacher-env'
    shutil.copy2(setup / 'cargo-target/release/ordered-outcome-env', binary)
    save(setup / 'build.json', dict(status='complete', binary=str(binary), sha256=sha(binary), source=manifest, at=time.time()))


class Native:
    def __init__(self, binary):
        self.process = subprocess.Popen([str(binary)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    def call(self, value):
        self.process.stdin.write(json.dumps(value)+'\n'); self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError('Native teacher exited')
        result = json.loads(line)
        if not result.get('ok'):
            raise RuntimeError(result)
        return result['result']
    def close(self):
        self.process.stdin.close()
        assert self.process.wait(timeout=30) == 0


def validate(setup, live, parallel=False):
    setup, live = Path(setup), Path(live)
    plan = read(live / 'teacher/plan.json')
    os.environ.update(CRIBBAGE_RUST_MODEL_ROOT=plan['assetRoot'], CRIBBAGE_283_FAST_ASSET=plan['openingAssetPath'])
    binary = setup / 'teacher-env'
    assert sha(binary) == read(setup / 'build.json')['sha256']
    sys.path.insert(0, str(live / 'model31/source'))
    from resources import LEDGER
    # Initial preflight uses only two concurrent arenas. The deployment probe
    # exercises the full budget after the old collector reaches its stop.
    capacity = max(1, (os.cpu_count() or 12) - 1)
    requested = capacity if parallel else min(2, capacity)
    with reserve_workers(LEDGER, setup.name + '-validate', requested, os.cpu_count() or 12) as count:
        assert count > 0, 'No CPU capacity for native validation'
        workers = count if parallel else capacity
        clients = [Native(live / 'teacher/teacher-env'), Native(binary)]
        try:
            assert native_worker_limit(clients[1].call, capacity) == capacity
            reset = dict(kind='reset', workers=1, ace=False, nativeModel='schell_table-peg_table-28.3.fast',
                         games=[dict(seed=8110403+i, orientation=i%2) for i in range(count)])
            states = [c.call(reset) for c in clients]
            checked = 0
            for _ in range(4):  # both discard actors and the first pegging decisions
                assert states[0] == states[1]
                ids = [row['id'] for row in states[0]['pending']]
                outputs = [client.call(dict(kind='teach', workers=w, ids=ids))['labels']
                           for client, w in zip(clients, [min(8, count), workers])]
                actions = [[x['id'], x['action']] for x in outputs[0]]
                assert actions == [[x['id'], x['action']] for x in outputs[1]], 'Ace actions changed'
                checked += len(actions)
                states = [client.call(dict(kind='step', actions=actions)) for client in clients]
        finally:
            for client in clients:
                client.close()
    save(setup / ('parallel-validation.json' if parallel else 'validate.json'), dict(status='complete',
         workers=workers, workerCapacity=capacity, simultaneousArenas=count, decisions=checked, originalActionsIdentical=True,
         teacherIdentity=plan['teacherIdentity'], binarySha256=sha(binary), at=time.time()))


if __name__ == '__main__':
    stage, setup, live = sys.argv[1:]
    if stage == 'build':
        build(Path(setup), Path(live))
    elif stage == 'validate':
        validate(Path(setup), Path(live))
    elif stage == 'parallel-validate':
        validate(Path(setup), Path(live), parallel=True)
    else:
        raise ValueError(stage)
