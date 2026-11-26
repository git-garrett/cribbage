"""One recoverable native self-play transaction; no Python model/game hot loops."""
import fcntl
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

from hybrid import latest32, pending, publish32, read, save, gpu_cpu


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def files(folder):
    return {str(p.relative_to(folder)): sha(p) for p in sorted(Path(folder).rglob('*')) if p.is_file()}


def verify(folder, manifest):
    for name, digest in manifest.items():
        assert sha(Path(folder) / name) == digest, f'Self-play identity changed: {name}'


def freeze(source, target):
    """Hard links are safe: trainers read input and atomically replace output files."""
    target = Path(target)
    temporary = target.with_name(target.name + '.partial')
    if temporary.exists():
        shutil.rmtree(temporary)
    shutil.copytree(source, temporary, copy_function=os.link)
    before = files(temporary)
    verify(source, before)
    temporary.rename(target)
    return before


def reserve(root, identity, games):
    config = read(root / 'checkpoint-config.json')
    # Amortize the global ledger over 4096 chunks. Each sequence gets a fixed,
    # nonoverlapping slice, including after a crash or batch-size change.
    chunks_per_pool = 4096
    pool, offset = divmod(identity['sequence'] - 1, chunks_per_pool)
    pool_size = 2 * games * chunks_per_pool
    reserved = Path(config['runtimes']) / (root.name + f'-selfplay-{identity["model"]}-g{games}-pool{pool:06d}')
    ledger = Path(config['runtimes']) / 'coordination/ordered-outcome-seed-reservations.json'
    existing = next((entry['ranges'] for entry in read(ledger, []) if entry['root'] == str(reserved)), None)
    if existing is None:
        script = ('import sys,json;from pathlib import Path;sys.path.insert(0,sys.argv[1]);'
                  'from prepare_run import reserve_seeds;'
                  'print(json.dumps(reserve_seeds(Path(sys.argv[2]),Path(sys.argv[3]),'
                  'Path(sys.argv[4]),sizes=dict(selfplay=int(sys.argv[5])))))')
        existing = __import__('json').loads(subprocess.check_output([
            config['python'], '-c', script, str(root / 'model31/source'), str(reserved),
            config['repo'], config['historicalSeeds'], str(pool_size)], text=True))
    assert existing['selfplay'][1] - existing['selfplay'][0] + 1 == pool_size
    start = existing['selfplay'][0] + offset * 2 * games
    return dict(selfplay=[start, start + 2 * games - 1], pool=existing['selfplay'], reservation=str(reserved))


def prepare(root, identity):
    folder = Path(identity['folder'])
    folder.mkdir(parents=True, exist_ok=True)
    manifest = read(folder / 'manifest.json')
    if manifest:
        assert manifest['identity'] == identity
        verify(folder / 'input', manifest['inputFiles'])
        for path, digest in manifest['binaries'].items():
            assert sha(path) == digest
        return manifest
    model = identity['model']
    model_root = root / f'model{model}'
    if model == 31:
        pointer = read(model_root / 'data/current.json')
        assert pointer['round'] == identity['aceRound']
        source = model_root / 'data' / pointer['folder']
        assert read(source / 'ace-teacher-state.json')['cursor'] == identity['cursors']
    else:
        source = latest32(root, identity['aceRound'])
        assert read(source / 'checkpoint.json')['teacherCursor'] == identity['cursors']
    # An interrupted prepare has no gradient updates and no published pointer.
    if (folder / 'input').exists():
        shutil.rmtree(folder / 'input')
    input_files = freeze(source, folder / 'input')
    settings = read(root / 'config.json')['selfPlay']
    assert settings['wpHalfLifeGames'] == 2_000_000, 'Native WP uses the established two-million-game half-life'
    assert settings['gamesPerPhase'] > 0
    reservation = reserve(root, identity, settings['gamesPerPhase'])
    cfg = read(model_root / ('config.json' if model == 31 else 'campaign-config.json'))
    if model == 31:
        binaries = cfg['nativeCpp']['hashes']
    else:
        binaries = {str(p): sha(p) for p in [model_root / 'build/libmodel32_33.dylib',
                                             model_root / 'cargo-target/release/libmodel3233_env.dylib']}
    for path, digest in binaries.items():
        assert sha(path) == digest, 'Native binary identity changed: ' + path
    manifest = dict(identity=identity, source=str(source), inputFiles=input_files, settings=settings,
                    seedReservation=reservation, binaries=binaries, createdAt=time.time(), config=cfg)
    save(folder / 'manifest.json', manifest)
    return manifest


def learn31(root, folder, manifest):
    import native_training
    identity = manifest['identity']
    settings = manifest['settings']
    cfg = dict(manifest['config'])
    for key in ['aceTeacher', 'gpuBatchTuning']:
        cfg.pop(key, None)
    seed = manifest['seedReservation']['selfplay'][0]
    cfg.update(runRoot=str(folder), cycle=identity['sequence'], roundsPerCycle=1,
               gamesPerRound=settings['gamesPerPhase'], trainingSeed=seed,
               wpSeed=seed + settings['gamesPerPhase'], trainingBatch=settings['gameBatch'],
               minibatch=settings['minibatch'], candidateChunk=settings['candidateChunk'],
               candidateQueueDepth=1, exploration=settings['exploration'],
               wpLearningSource='greedy-self-play', wpRecencyHalfLifeGames=settings['wpHalfLifeGames'])
    save(folder / 'selfplay-config.json', cfg)
    if not read(folder / 'train-receipt.json'):
        native_training.train(folder, cfg)
    assert read(folder / 'train-receipt.json')['status'] == 'complete'
    output = folder / 'round-1'
    # Native training preserves cursors; retain the original teacher identity too.
    shutil.copyfile(folder / 'input/ace-teacher-state.json', output / 'ace-teacher-state.json')
    before = read(folder / 'input/wp-state.json')
    after = read(output / 'wp-state.json')
    assert after['recency']['games'] - before['recency']['games'] == settings['gamesPerPhase']
    assert len(after['rounds']) == len(before['rounds']) + 1
    return output


def learn32(root, folder, manifest):
    import campaign as c
    from native import Backend
    from runner import Player
    model_root = root / 'model32'
    settings = manifest['settings']
    player = Player.load(Backend(model_root), folder / 'input', True)
    initial_games, initial_round = player.games, player.round
    seed = manifest['seedReservation']['selfplay'][0]
    cfg = dict(manifest['config'], seed=seed, gameBatch=settings['gameBatch'],
               chunk=settings['candidateChunk'], minibatch=settings['minibatch'])
    save(folder / 'selfplay-config.json', cfg)
    output = folder / 'result'
    try:
        if not read(folder / 'train-receipt.json'):
            # Local round zero keeps the reserved seed block exact. The model's
            # cumulative generation advances only after the complete transaction.
            player, work, parts = c.live_round(model_root, folder, player, {'seconds': 0.}, cfg,
                                                settings['gamesPerPhase'], 0)
            player.round = initial_round + 1
            assert player.games == initial_games + settings['gamesPerPhase']
            assert player.teacher_cursor == manifest['identity']['cursors']
            if output.exists():
                shutil.rmtree(output)
            player.save(output)
            save(folder / 'train-receipt.json', dict(status='complete', greedyGames=player.games,
                 generation=player.round, gamesPerPhase=settings['gamesPerPhase']))
    finally:
        player.close()
    return output


def archive(root, folder, manifest):
    """Retain game evidence and training rows, with bounded local model storage."""
    destination = Path(read(root / 'config.json')['archive']) / 'selfplay' / f'model{manifest["identity"]["model"]}' / folder.name
    excluded = {'input', 'result', 'round-1'}
    def retained(path):
        parts = path.relative_to(folder).parts
        return parts[0] not in excluded and not any(p.startswith('checkpoint-') for p in parts) and path.suffix != '.npz' and path.name not in ['receipt.json', 'archive.json']
    expected = {str(p.relative_to(folder)): sha(p) for p in sorted(folder.rglob('*')) if p.is_file() and retained(p)}
    receipt = read(destination / 'archive-manifest.json')
    if receipt is None:
        temporary = destination.with_name(destination.name + '.partial')
        if temporary.exists():
            shutil.rmtree(temporary)
        temporary.mkdir(parents=True)
        for name in expected:
            target = temporary / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(folder / name, target)
        verify(temporary, expected)
        save(temporary / 'archive-manifest.json', expected)
        temporary.rename(destination)
    else:
        assert receipt == expected, 'Self-play archive identity differs'
    verify(destination, expected)
    save(folder / 'archive.json', dict(status='complete', archive=str(destination), files=expected))
    return destination


def publish(root, folder, manifest, output):
    identity = manifest['identity']
    model = identity['model']
    model_root = root / f'model{model}'
    target = model_root / 'data' / f'selfplay-{identity["sequence"]:08d}'
    if not target.exists():
        output.rename(target)
    assert files(target) == read(folder / 'trained.json')['files']
    if model == 31:
        assert read(target / 'ace-teacher-state.json')['cursor'] == identity['cursors']
        save(model_root / 'data/current.json', dict(folder=target.name, round=identity['aceRound'],
                                                  selfPlaySequence=identity['sequence']))
    else:
        assert read(target / 'checkpoint.json')['teacherCursor'] == identity['cursors']
        publish32(root, identity['aceRound'], target, 'self-play')
    result = dict(status='complete', identity=identity, checkpoint=str(target), cursors=identity['cursors'],
                  gamesPerPhase=manifest['settings']['gamesPerPhase'], wpHalfLifeGames=2_000_000,
                  archive=read(folder / 'archive.json')['archive'], sourceCheckpoint=manifest.get('source'), completedAt=time.time())
    # Receipt precedes cleanup, so a restart after publication never learns again.
    save(folder / 'receipt.json', result)
    return result


def cleanup(folder, result):
    # Release staging and superseded working checkpoints after publication.
    # Named round snapshots, frozen references and periodic archives remain.
    folder = Path(folder)
    for child in folder.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
    target = Path(result['checkpoint'])
    source = result.get('sourceCheckpoint')
    if source:
        prior = Path(source)
        if (target.parent.parent.name == 'model31' and prior.parent == target.parent
                and prior != target and prior.name.startswith('checkpoint-')
                and prior.is_dir() and not prior.is_symlink()):
            shutil.rmtree(prior)
    for prior in target.parent.glob('selfplay-*'):
        if prior != target and prior.is_dir():
            shutil.rmtree(prior)


def run(root):
    root = Path(root)
    identity = pending(root)
    assert identity is not None
    folder = Path(identity['folder'])
    existing = read(folder / 'receipt.json')
    if existing:
        assert existing['identity'] == identity
        cleanup(folder, existing)
        return existing
    model_root = root / f'model{identity["model"]}'
    sys.path.insert(0, str(root / 'model31/source'))
    from resources import LEDGER
    with (model_root / 'writer.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with gpu_cpu(root, LEDGER):
            import ctypes as ct
            objc = ct.CDLL('/usr/lib/libobjc.A.dylib')
            ct.CDLL('/System/Library/Frameworks/Foundation.framework/Foundation')
            objc.objc_getClass.argtypes = [ct.c_char_p]; objc.objc_getClass.restype = ct.c_void_p
            objc.sel_registerName.argtypes = [ct.c_char_p]; objc.sel_registerName.restype = ct.c_void_p
            objc.objc_msgSend.argtypes = [ct.c_void_p, ct.c_void_p]; objc.objc_msgSend.restype = ct.c_void_p
            process = objc.objc_msgSend(objc.objc_getClass(b'NSProcessInfo'), objc.sel_registerName(b'processInfo'))
            thermal = objc.sel_registerName(b'thermalState')
            objc.objc_msgSend.restype = ct.c_long
            while True:
                sample = dict(pressure=int(subprocess.check_output(['/usr/sbin/sysctl', '-n', 'kern.memorystatus_vm_pressure_level'])),
                              thermal=int(objc.objc_msgSend(process, thermal)))
                if shutil.disk_usage(root).free >= 5 * 2**30 and sample['pressure'] < 4 and sample['thermal'] < 2:
                    break
                save(root / 'gpu-live.json', dict(status='self-play waiting for system resources',
                     pressure=sample['pressure'], thermal=sample['thermal'], **identity))
                if (root / 'STOP-TRAIN').exists():
                    raise SystemExit(76)
                time.sleep(3)
            manifest = prepare(root, identity)
            sys.path.insert(0, str(model_root / 'source'))
            trained = read(folder / 'trained.json')
            if trained:
                output = Path(trained['output'])
                # A crash may have occurred after moving the output but before
                # publishing its pointer/receipt. Keep that exact output.
                if not output.exists():
                    output = model_root / 'data' / f'selfplay-{identity["sequence"]:08d}'
                verify(output, trained['files'])
            else:
                output = (learn31 if identity['model'] == 31 else learn32)(root, folder, manifest)
                verify(folder / 'input', manifest['inputFiles'])
                assert files(output) != manifest['inputFiles'], 'No self-play update was produced'
                save(folder / 'trained.json', dict(output=str(output), files=files(output)))
            archive(root, folder, manifest)
            result = publish(root, folder, manifest, output)
            cleanup(folder, result)
            return result


if __name__ == '__main__':
    root = Path(sys.argv[1])
    sys.path.insert(0, str(root / 'model31/source'))
    from resources import ResourceLimit
    try:
        run(root)
    except (ResourceLimit, SystemExit) as error:
        identity = pending(root)
        # Only measured resource pauses are resumable. Integrity errors and
        # explicit stops propagate to the one-shot supervisor without retry.
        resource_pause = isinstance(error, ResourceLimit) or (
            error.code == 75 and not (root / f'model{identity["model"]}' / 'STOP').exists()
            and not (root / f'model{identity["model"]}' / 'INTERRUPTED.json').exists())
        if not resource_pause:
            raise
        save(Path(identity['folder']) / 'resource-pause.json',
             dict(status='resource-pause', identity=identity, reason=str(error), at=time.time()))
        raise SystemExit(75)
