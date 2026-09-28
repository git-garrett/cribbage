#!/usr/bin/env python3
"""Build releases with checked PGO on Mac or an explicitly selected native server."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {
    'api': [('cribbage-api', 'cribbage-api')],
    'benchmark': [('cribbage-runner', 'cribbage-runner')],
    'shadow': [('cribbage-shadow-engine', 'cribbage-shadow-engine')],
}


def run(args, **kwargs):
    return subprocess.run([str(x) for x in args], check=True, **kwargs)


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def save(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def rustflags(env):
    encoded = env.get('CARGO_ENCODED_RUSTFLAGS')
    if encoded is not None:
        flags = encoded.split('\x1f') if encoded else []
    else:
        flags = shlex.split(env.get('RUSTFLAGS', ''))
    if any('profile-generate' in flag or 'profile-use' in flag for flag in flags):
        raise ValueError('PGO profile flags are owned by this build script; remove caller profile flags')
    return flags


def compiler_env(env, flags, target_dir):
    result = dict(env, CARGO_ENCODED_RUSTFLAGS='\x1f'.join(flags),
                  CARGO_TARGET_DIR=str(target_dir))
    result.pop('RUSTFLAGS', None)
    return result


def profile_tool(host):
    explicit = os.environ.get('LLVM_PROFDATA')
    if explicit:
        if not Path(explicit).is_file():
            raise ValueError('LLVM_PROFDATA must name an existing executable')
        return explicit
    sysroot = run(['rustc', '--print', 'sysroot'], capture_output=True, text=True).stdout.strip()
    bundled = Path(sysroot) / 'lib/rustlib' / host / 'bin/llvm-profdata'
    if bundled.is_file():
        return str(bundled)
    if sys.platform == 'linux':
        found = shutil.which('llvm-profdata')
        if found:
            return found
        raise ValueError('PGO requires llvm-profdata matching the Rust compiler LLVM version')
    found = subprocess.run(['xcrun', '--find', 'llvm-profdata'], capture_output=True, text=True)
    if found.returncode == 0 and found.stdout.strip():
        return found.stdout.strip()
    raise ValueError('PGO requires llvm-profdata; install rustup component add llvm-tools-preview')


def inputs(root, model_root, corpus):
    paths = [root / 'rust/Cargo.toml', root / 'rust/Cargo.lock', corpus,
             root / 'scripts/build_rust_release.py']
    for member in sorted((root / 'rust').glob('cribbage-*')):
        if member.is_dir():
            paths.extend(p for p in member.rglob('*')
                         if p.is_file() and p.suffix in ('.rs', '.toml')
                         and 'target' not in p.relative_to(member).parts)
    assets = model_root / 'rust/cribbage-shadow-engine/assets'
    if not assets.is_dir():
        raise ValueError('model root must contain rust/cribbage-shadow-engine/assets')
    paths.extend(p for p in assets.iterdir() if p.is_file())
    return {str(p.resolve()): digest(p) for p in sorted(set(paths))}


def same_values(reference, actual, label):
    if reference['model'] != actual['model'] or reference['values'] != actual['values']:
        raise ValueError('PGO decision/value parity failed: ' + label)


def publish(binaries, destination):
    """Stage every copy before replacing any public artifact."""
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.pgo-publish-', dir=destination) as temporary:
        staged = Path(temporary)
        for name, source in binaries.items():
            shutil.copy2(source, staged / name)
        for name in binaries:
            os.replace(staged / name, destination / name)


def build(options):
    root = options.root.resolve()
    model_root = (options.model_root or root).resolve()
    corpus = (options.corpus or root / 'scripts/pgo-fixtures.json').resolve()
    target_dir = (options.target_dir or Path(os.environ.get('CARGO_TARGET_DIR', root / 'rust/target'))).resolve()
    compiler = run(['rustc', '-vV'], capture_output=True, text=True).stdout
    host = next(line[6:] for line in compiler.splitlines() if line.startswith('host: '))
    target = options.target or os.environ.get('CARGO_BUILD_TARGET') or host
    if options.pgo and (target != host or sys.platform not in ('darwin', 'linux')):
        raise ValueError('PGO training requires a native Mac or Linux build')
    pgo = (sys.platform == 'darwin' or options.pgo) and target == host and not options.no_pgo
    if options.api_tests and (not pgo or options.kind != 'api'):
        raise ValueError('--api-tests requires a PGO API build')
    cargo = ['cargo', 'build', '--locked', '--release', '--manifest-path', root / 'rust/Cargo.toml']
    if options.offline:
        cargo.append('--offline')
    selected = TARGETS[options.kind]
    for package, binary in selected:
        cargo.extend(['-p', package, '--bin', binary])
    if not pgo:
        if options.target:
            cargo.extend(['--target', target])
        run(cargo, env=dict(os.environ, CARGO_TARGET_DIR=str(target_dir)), cwd=root)
        if options.kind == 'shadow':
            output = target_dir / target / 'release' if options.target or os.environ.get('CARGO_BUILD_TARGET') else target_dir / 'release'
            publish({'cribbage-shadow-engine': output / 'cribbage-shadow-engine'}, root / 'rust/cribbage-shadow-engine')
        print('Standard release build complete (PGO not requested for this target).')
        return

    flags = rustflags(os.environ)
    merger = profile_tool(host)
    models = options.model or ['ace']
    work = target_dir / 'pgo' / options.kind
    work.mkdir(parents=True, exist_ok=True)
    with (work / 'build.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError('Another PGO build of this target is running') from error
        started = time.monotonic()
        run_dir = Path(tempfile.mkdtemp(prefix='run-', dir=work))
        profile = run_dir / 'merged.profdata'
        provenance = inputs(root, model_root, corpus)
        record = dict(status='running',compiler=compiler,target=target,models=models,
                      flags=flags,inputs=provenance,profile=str(profile),stages={},results={})
        record['gitCommit'] = os.environ.get('CRIBBAGE_BUILD_GIT_COMMIT')
        record['profileTool'] = merger
        record['compact'] = options.compact
        save(run_dir / 'build.json', record)
        if ('cribbage-shadow-engine', 'cribbage-decision-worker') not in selected and options.kind != 'shadow':
            cargo.extend(['-p', 'cribbage-shadow-engine'])
        cargo.extend(['--bin', 'pgo-workload', '--target', target])
        kind = 'reviews' if options.kind == 'api' else 'play'

        def compile_variant(name, extra):
            before = time.monotonic()
            directory = run_dir / 'cargo' if options.compact else work / name
            run(cargo, cwd=root, env=compiler_env(os.environ, flags + extra, directory))
            output = directory / target / 'release'
            if name == 'optimized' and options.api_tests:
                test_command = ['cargo', 'test', '--locked', '--release', '--manifest-path',
                                root / 'rust/Cargo.toml', '-p', 'cribbage-api', '--target', target]
                if options.offline:
                    test_command.append('--offline')
                # Keep the full-asset suite in a separate process, as predeploy QA
                # does, so model tables from unrelated tests are not retained.
                for selection in [[], ['--ignored']]:
                    run(test_command + ['--', '--test-threads=1'] + selection, cwd=root,
                        env=compiler_env(os.environ, flags + extra, directory))
                record['apiTestsPassed'] = True
            if options.compact:
                preserved = run_dir / name
                binaries = {binary: output / binary for _, binary in selected}
                binaries['pgo-workload'] = output / 'pgo-workload'
                publish(binaries, preserved)
                shutil.rmtree(directory)
                output = preserved
            record['stages'][name] = time.monotonic() - before
            save(run_dir / 'build.json', record)
            return output

        def replay(directory, suite, model_name, env):
            output = run([directory / 'pgo-workload', corpus, model_root, model_name, suite, kind],
                         cwd=root, env=env, capture_output=True, text=True)
            result = json.loads(output.stdout)
            if not result.get('values'):
                raise ValueError('Empty PGO workload results')
            return result

        try:
            baseline = compile_variant('baseline', [])
            reference = {(m, s): replay(baseline, s, m, os.environ)
                         for m in models for s in ['train', 'validate']}
            raw = run_dir / 'raw'
            instrumented = compile_variant('instrumented', ['-Cprofile-generate=' + str(raw)])
            for m in models:
                trained = replay(instrumented, 'train', m,
                                 dict(os.environ, LLVM_PROFILE_FILE=str(raw / '%p-%m.profraw')))
                same_values(reference[m, 'train'], trained, m + '/training')
            run([merger, 'merge', raw, '-o', profile])
            optimized = compile_variant('optimized', ['-Cprofile-use=' + str(profile),
                                        '-Cllvm-args=-pgo-warn-missing-function'])
            for m in models:
                for suite in ['train', 'validate']:
                    actual = replay(optimized, suite, m, os.environ)
                    same_values(reference[m, suite], actual, m + '/' + suite)
                    record['results'][m + '/' + suite] = dict(
                        cases=len(actual['values']), bitExact=True,
                        baselineSeconds=reference[m, suite]['seconds'],
                        optimizedSeconds=actual['seconds'])
            if provenance != inputs(root, model_root, corpus):
                raise ValueError('Source or model assets changed during the PGO build; refusing to publish')
            binaries = {name: optimized / name for _, name in selected}
            record.update(status='complete',seconds=time.monotonic()-started,
                          profileSha256=digest(profile),
                          binaries={name:digest(path) for name,path in binaries.items()})
            publish(binaries, target_dir / 'release')
            if options.kind == 'shadow':
                publish(binaries, root / 'rust/cribbage-shadow-engine')
            save(run_dir / 'build.json', record)
            save(work / 'latest.json', record)
            print('PGO release build complete: ' + ', '.join(binaries) + '; exact parity passed. Receipt: ' + str(work / 'latest.json'))
        except BaseException as error:
            record.update(status='failed',error=str(error))
            save(run_dir / 'build.json', record)
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=TARGETS)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--model-root', type=Path)
    parser.add_argument('--corpus', type=Path)
    parser.add_argument('--target-dir', type=Path)
    parser.add_argument('--target')
    parser.add_argument('--model', action='append', help='Repeat to train all engines in a matchup; default: current Ace')
    parser.add_argument('--offline', action='store_true')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--no-pgo', action='store_true', help='Explicit diagnostic escape hatch')
    mode.add_argument('--pgo', action='store_true', help='Also enable checked PGO for native Linux')
    parser.add_argument('--compact', action='store_true', help='Remove each temporary Cargo build after preserving its binaries')
    parser.add_argument('--api-tests', action='store_true', help='Require the optimized API test suite, including installed-asset tests')
    try:
        build(parser.parse_args())
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print('Release build failed: ' + str(error), file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError) and error.stderr:
            print(error.stderr, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
