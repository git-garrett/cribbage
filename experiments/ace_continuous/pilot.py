"""Native GPU preflight on immutable periodic-checkpoint copies."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys

from hybrid import begin, finish, latest32, read, save


def run(setup, live):
    setup, live = Path(setup), Path(live)
    pilot = setup / 'pilot'
    pilot.mkdir(exist_ok=True)
    schedule = read(live / 'checkpoint-state.json')
    frozen = Path(schedule['lastCheckpoint'])
    state = read(frozen / 'manifest.json')['trainingState']
    python = read(live / 'checkpoint-config.json')['python']
    for name in ['hybrid.py', 'selfplay.py']:
        shutil.copy2(setup / 'payload' / name, pilot / name)
    for model in [31, 32]:
        root = pilot / f'model{model}'
        root.mkdir(exist_ok=True)
        for name in ['source', 'build', 'cargo-target']:
            source = live / f'model{model}' / name
            if source.exists() and not (root / name).exists():
                (root / name).symlink_to(source.resolve(), target_is_directory=True)
        cfg_name = 'config.json' if model == 31 else 'campaign-config.json'
        shutil.copy2(live / f'model{model}' / cfg_name, root / cfg_name)
        initial = root / 'data/input'
        if not initial.exists():
            initial.parent.mkdir(exist_ok=True)
            shutil.copytree(frozen / f'candidate-{model}', initial, copy_function=__import__('os').link)
        if model == 31 and not (root / 'data/current.json').exists():
            save(root / 'data/current.json', dict(round=state['31']['round'], folder='input'))
        elif model == 32 and not (pilot / 'hybrid-model32.json').exists():
            save(pilot / 'hybrid-model32.json', dict(aceRound=state['32']['round'], checkpoint=str(initial)))
    save(pilot / 'gpu-state.json', state)
    cfg = read(live / 'config.json')
    cfg.update(archive=str(setup / 'pilot-archive'), selfPlay=dict(enabled=True, gamesPerPhase=2,
        gameBatch=2, minibatch=32, candidateChunk=64, exploration=.1, wpHalfLifeGames=2_000_000))
    save(pilot / 'config.json', cfg)
    shutil.copy2(live / 'checkpoint-config.json', pilot / 'checkpoint-config.json')
    import numpy as np
    reports = []
    for model in [31, 32]:
        progress = read(pilot / 'hybrid-state.json', {})
        completed = progress.get('sequences', {}).get(str(model), 0) >= 1
        if completed:
            active = read(pilot / 'hybrid' / f'model{model}' / '00000001/receipt.json')['identity']
        else:
            active = begin(pilot, state)
            assert active['model'] == model
            subprocess.run([python, str(pilot / 'selfplay.py'), str(pilot)], check=True)
        receipt = read(Path(active['folder']) / 'receipt.json')
        before = pilot / f'model{model}/data/input'
        after = Path(receipt['checkpoint'])
        assert receipt['cursors'] == state[str(model)]['cursors']
        # A restart after publication must be an exact no-op, including WP.
        def digest(path):
            with path.open('rb') as stream:
                return hashlib.file_digest(stream, 'sha256').hexdigest()
        hashes = {p.name: digest(p) for p in after.iterdir() if p.is_file()}
        if not completed:
            subprocess.run([python, str(pilot / 'selfplay.py'), str(pilot)], check=True)
        assert hashes == {p.name: digest(p) for p in after.iterdir() if p.is_file()}
        if model == 31:
            roles = ['pone-peg', 'dealer-peg', 'pone-discard', 'dealer-discard']
            for role in roles:
                with np.load(before / (role + '-optimizer.npz')) as old, np.load(after / (role + '-optimizer.npz')) as new:
                    assert int(new['step']) > int(old['step'])
                assert digest(before / (role + '.npz')) != digest(after / (role + '.npz'))
            old_wp, new_wp = read(before / 'wp-state.json'), read(after / 'wp-state.json')
            assert new_wp['recency']['games'] == old_wp['recency']['games'] + 2
            assert new_wp['tableSha256'] != old_wp['tableSha256']
            evidence = np.zeros((2, 121, 121), np.uint64)
            for path in Path(receipt['archive']).glob('data/round-1-greedy-wp-wp-evidence.bin'):
                evidence += np.fromfile(path, dtype='<u8').reshape(2, 121, 121)
            assert evidence.sum() > 0
            with np.load(before / 'wp-state.npz') as old, np.load(after / 'wp-state.npz') as new:
                np.testing.assert_allclose(new['weighted_visits'], old['weighted_visits'] * 2**(-2/2_000_000) + evidence[0], rtol=1e-14)
                np.testing.assert_allclose(new['weighted_wins'], old['weighted_wins'] * 2**(-2/2_000_000) + evidence[1], rtol=1e-14)
        else:
            old_meta, new_meta = read(before / 'checkpoint.json'), read(after / 'checkpoint.json')
            assert new_meta['greedyGames'] == old_meta['greedyGames'] + 2
            for old, new in zip(old_meta['networks'], new_meta['networks']):
                assert new['step'] > old['step']
            evidence = np.zeros((2, 121, 121), np.uint64)
            for path in Path(receipt['archive']).glob('round-000000/greedy-*/evidence.bin'):
                evidence += np.fromfile(path, dtype='<u8').reshape(2, 121, 121)
            assert evidence.sum() > 0
            with np.load(before / 'wp.npz') as old, np.load(after / 'wp.npz') as new:
                np.testing.assert_allclose(new['visits'], old['visits'] * 2**(-2/2_000_000) + evidence[0], rtol=1e-14)
                np.testing.assert_allclose(new['wins'], old['wins'] * 2**(-2/2_000_000) + evidence[1], rtol=1e-14)
                assert np.any(new['wp'] != old['wp'])
        reports.append(dict(model=model, status='complete', trainingGames=2, greedyWpGames=2,
                            cursorsUnchanged=True, optimizerAdvanced=True, wpChanged=True, restartNoOp=True))
        if not completed:
            finish(pilot, active)
    save(setup / 'pilot.json', dict(status='complete', reports=reports))


if __name__ == '__main__':
    run(Path(sys.argv[1]), Path(sys.argv[2]))
