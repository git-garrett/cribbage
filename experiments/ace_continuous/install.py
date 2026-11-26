"""Deploy only at cooperative boundaries; preserve state and resume on failure."""
import fcntl
from pathlib import Path
import shutil
import subprocess
import sys
import time

from hybrid import publish32, read, save

SETUP = Path(__file__).resolve().parent


def restart_jobs(root, runner, jobs):
    """Attempt independent restarts even when one process cannot be restored."""
    errors = []
    for job in jobs:
        (root / job['flag']).unlink(missing_ok=True)
        (root / job['receipt']).unlink(missing_ok=True)
    for job in jobs:
        try:
            subprocess.run([sys.executable, str(runner), 'install', str(root / (job['name'] + '.json'))], check=True)
            spec = read(root / (job['name'] + '.json'))
            label = 'com.strongcribbage.job.' + spec['jobId']
            plist = Path(spec['jobRoot']) / (label + '.plist')
            shutil.copy2(plist, Path.home() / 'Library/LaunchAgents' / plist.name)
        except Exception as error:
            errors.append(dict(job=job['name'], error=str(error)))
    if errors:
        save(SETUP / 'restart-errors.json', dict(status='failed', errors=errors))
        raise RuntimeError('Independent restart attempts failed: ' + str(errors))


def install(root):
    root = Path(root)
    assert read(SETUP / 'pilot.json')['status'] == 'complete'
    assert read(SETUP / 'handoff-pilot.json')['status'] == 'complete'
    runner = SETUP / 'cribbage_job_queue.py'
    targets = {
        **{name: name for name in ['train.py', 'collect.py', 'hybrid.py', 'selfplay.py', 'checkpoints.py', 'evaluate.py', 'finish.py']},
        'model31/train.py': 'model31_train.py', 'model32/train.py': 'model32_train.py',
    }
    backup = SETUP / 'backup'
    backup.mkdir(exist_ok=True)
    paths = [*targets, 'config.json', 'model31/config.json', 'hybrid-model32.json']
    assert not (SETUP / 'deployed.json').exists(), 'This release is already deployed'
    existing = {name: (root / name).exists() for name in paths}
    for name in paths:
        if existing[name]:
            dest = backup / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not dest.exists():
                shutil.copy2(root / name, dest)
    save(SETUP / 'before.json', dict(existing=existing, state=read(root / 'gpu-state.json')))
    jobs = [dict(name='ace-gpu-training', flag='STOP-TRAIN', receipt='gpu-stopped.json'),
            dict(name='ace-label-production', flag='STOP-COLLECT', receipt='teacher/stopped.json')]
    paused = []
    success = False
    try:
        for job in jobs:
            (root / job['receipt']).unlink(missing_ok=True)
            (root / job['flag']).touch()
            paused.append(job)
        deadline = time.monotonic() + 1800
        while True:
            states = {job['name']: read(root / (job['name'] + '-supervisor/status.json'), {}) for job in jobs}
            save(SETUP / 'deploy-progress.json', dict(status='waiting for cooperative stop',
                 states={name: state.get('state') for name, state in states.items()}, updatedAt=time.time()))
            if all(state.get('state') == 'complete' for state in states.values()) and all((root / job['receipt']).exists() for job in jobs):
                break
            if any(state.get('state') == 'failed' for state in states.values()):
                raise RuntimeError('An existing process failed while reaching its safe boundary')
            if time.monotonic() >= deadline:
                raise TimeoutError('Processes did not reach their safe boundary')
            time.sleep(2)
        for job in jobs:
            subprocess.run([sys.executable, str(runner), 'stop', str(root / (job['name'] + '.json'))], check=True)
        # Hold both writer locks throughout the code/pointer handoff.
        from contextlib import ExitStack
        with ExitStack() as locks:
            for model in [31, 32]:
                lock = locks.enter_context((root / f'model{model}/writer.lock').open('a'))
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            state = read(root / 'gpu-state.json')
            source32 = Path(read(root / 'model32' / f'model32-round-{state["32"]["round"]}.json')['checkpoint'])
            assert read(source32 / 'checkpoint.json')['teacherCursor'] == state['32']['cursors']
            source31 = root / 'model31/data' / read(root / 'model31/data/current.json')['folder']
            assert read(source31 / 'ace-teacher-state.json')['cursor'] == state['31']['cursors']
            save(SETUP / 'paused.json', dict(status='complete', state=state))
            for dest, source in targets.items():
                target = root / dest
                temporary = target.with_name(target.name + '.upgrade')
                shutil.copy2(SETUP / 'payload' / source, temporary)
                temporary.replace(target)
            config = read(root / 'config.json')
            config['selfPlay'] = dict(enabled=True, gamesPerPhase=32, gameBatch=8, minibatch=32,
                                     candidateChunk=64, exploration=.1, wpHalfLifeGames=2_000_000)
            save(root / 'config.json', config)
            cfg31 = read(root / 'model31/config.json')
            cfg31.update(trainingPolicy='Ace batches take priority; native outcome self-play between batches.',
                         wpPolicy='Greedy self-play updates between complete rounds; two-million-game recency half-life.')
            save(root / 'model31/config.json', cfg31)
            publish32(root, state['32']['round'], source32, 'ace')
            save(SETUP / 'deployed.json', dict(status='complete', state=state, settings=config['selfPlay'], at=time.time()))
            success = True
    finally:
        if not success:
            for name in paths:
                target = root / name
                if existing[name]:
                    shutil.copy2(backup / name, target)
                else:
                    target.unlink(missing_ok=True)
        restart_jobs(root, runner, paused)
    save(SETUP / 'install.json', dict(status='complete', resumed=['training', 'Ace collection'], at=time.time()))


if __name__ == '__main__':
    with (SETUP / 'install.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        install(Path(sys.argv[1]))
