"""Replace only the stopped Ace collector's native binary and worker governor."""
import fcntl
from pathlib import Path
import shutil
import subprocess
import sys
import time

from hybrid import read, save
from native_teacher import sha, validate

SETUP = Path(__file__).resolve().parent


def upgrade(root):
    root = Path(root)
    assert read(SETUP / 'build.json')['status'] == 'complete'
    assert read(SETUP / 'validation.json')['status'] == 'complete'
    assert not (SETUP / 'upgrade.json').exists(), 'This native upgrade is already installed'
    targets = ['collect.py', 'hybrid.py', 'teacher/teacher-env', 'teacher/plan.json']
    backup = SETUP / 'backup'
    for name in targets:
        dest = backup / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists():
            shutil.copy2(root / name, dest)
    spec = root / 'ace-label-production.json'
    runner = SETUP / 'cribbage_job_queue.py'
    (root / 'teacher/stopped.json').unlink(missing_ok=True)
    (root / 'STOP-COLLECT').touch()
    success = False
    try:
        deadline = time.monotonic() + 1800
        while True:
            state = read(root / 'ace-label-production-supervisor/status.json')
            if state['state'] == 'complete' and (root / 'teacher/stopped.json').exists():
                break
            if state['state'] == 'failed':
                raise RuntimeError('Collector failed while reaching its safe boundary')
            if time.monotonic() > deadline:
                raise TimeoutError('Collector did not reach its safe boundary')
            save(SETUP / 'upgrade-progress.json', dict(status='waiting for collector boundary', at=time.time()))
            time.sleep(2)
        subprocess.run([sys.executable, str(runner), 'stop', str(spec)], check=True)
        # All CPU claims from the old collector have been released. Training
        # keeps running; this probe reserves its complete, actual CPU budget.
        validate(SETUP, root, parallel=True)
        for source, dest in [('collect.py', 'collect.py'), ('hybrid.py', 'hybrid.py'), ('teacher-env', 'teacher/teacher-env')]:
            target = root / dest
            temporary = target.with_name(target.name + '.native-upgrade')
            shutil.copy2(SETUP / source, temporary)
            temporary.replace(target)
        plan = read(root / 'teacher/plan.json')
        plan.update(teacherBinarySha256=sha(root / 'teacher/teacher-env'),
                    maximumWorkers=read(SETUP / 'parallel-validation.json')['workers'],
                    nativeWorkerUpgrade=str(SETUP / 'parallel-validation.json'))
        # The immutable Ace policy/assets and validated decisions retain their
        # teacher identity; executable provenance is tracked separately.
        save(root / 'teacher/plan.json', plan)
        save(SETUP / 'deployed.json', dict(status='complete', binarySha256=plan['teacherBinarySha256'],
             maximumWorkers=plan['maximumWorkers'], teacherIdentity=plan['teacherIdentity'], at=time.time()))
        success = True
    finally:
        if not success:
            for name in targets:
                shutil.copy2(backup / name, root / name)
        (root / 'STOP-COLLECT').unlink(missing_ok=True)
        (root / 'teacher/stopped.json').unlink(missing_ok=True)
        subprocess.run([sys.executable, str(runner), 'install', str(spec)], check=True)
        config = read(spec)
        label = 'com.strongcribbage.job.' + config['jobId']
        plist = Path(config['jobRoot']) / (label + '.plist')
        shutil.copy2(plist, Path.home() / 'Library/LaunchAgents' / plist.name)
    save(SETUP / 'upgrade.json', dict(status='complete', collector='resumed', training='continued', at=time.time()))


if __name__ == '__main__':
    with (SETUP / 'upgrade.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        upgrade(Path(sys.argv[1]))
