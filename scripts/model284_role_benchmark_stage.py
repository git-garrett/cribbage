#!/usr/bin/env python3
"""Checked one-shot stages for role-segmented Ace 28.4 versus production Ace."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            digest.update(block)
    return digest.hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2)+'\n')


def missing_ranges(indices, count):
    if any(i < 0 or i >= count for i in indices):
        raise ValueError('completed game index outside the frozen contract')
    missing = sorted(set(range(count))-set(indices))
    ranges = []
    for index in missing:
        if ranges and ranges[-1][1] == index:
            ranges[-1][1] += 1
        else:
            ranges.append([index, index+1])
    return ranges


def check_existing_provenance(db, run_id, matchup_id, seed, expected):
    rows = db.execute('SELECT run_id,git_commit,run_seed,metadata_json FROM ai_runs').fetchall()
    if len(rows) != 1 or rows[0][:3] != (run_id, expected['sourceCommit'], str(seed)):
        raise ValueError('existing run identity differs from the frozen contract')
    metadata = json.loads(rows[0][3])
    if any(metadata.get(key) != value for key, value in expected.items()):
        raise ValueError('existing source/binary/belief provenance differs')
    if db.execute('SELECT COUNT(*) FROM compact_games WHERE run_id != ? OR matchup_id != ?',
                  (run_id, matchup_id)).fetchone()[0]:
        raise ValueError('existing game belongs to another run or matchup')


def main():
    root, mode = Path(sys.argv[1]).resolve(), sys.argv[2]
    cfg = json.loads((root/'experiment.json').read_bytes())
    source, output = root/'source', root/'output'
    output.mkdir(exist_ok=True)
    python, node = cfg['python'], cfg['node']
    frozen = json.loads((root/'frozen-inputs.json').read_bytes())
    for name, expected in frozen.items():
        if sha(root/name) != expected:
            raise ValueError('frozen dependency changed: '+name)
    base_env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools',
                    SOURCE_COMMIT=cfg['sourceCommit'])
    # The benchmark owns this exact opt-in. Inherited experiment controls must
    # never change its candidate or production opponent.
    for name in ('CRIBBAGE_284_BELIEFS_MANIFEST', 'EXPECTED_BELIEFS_MANIFEST_SHA256',
                 'CRIBBAGE_284_CORRECTIONS_MANIFEST', 'CRIBBAGE_283_FAST_ASSET'):
        base_env.pop(name, None)

    def run(command, **kwargs):
        return subprocess.run([str(v) for v in command], cwd=source,
                              env=kwargs.pop('env', base_env), check=True, **kwargs)

    def candidate_env():
        path = output/'beliefs/manifest.json'
        prepared = json.loads((output/'beliefs/prepared.json').read_bytes())
        if sha(path) != prepared['manifestSha256']:
            raise ValueError('prepared belief manifest changed')
        receipt = json.loads((output/'build-receipt.json').read_bytes())
        runner_sha = receipt['binaries']['cribbage-runner']
        if sha(root/'target/release/cribbage-runner') != runner_sha:
            raise ValueError('runner differs from its frozen PGO build')
        return dict(base_env, CRIBBAGE_284_BELIEFS_MANIFEST=str(path),
                    EXPECTED_BELIEFS_MANIFEST_SHA256=sha(path),
                    EXPECTED_RUNNER_SHA256=runner_sha)

    labels = [('28.4-left', cfg['candidate'], cfg['opponent']),
              ('ace-left', cfg['opponent'], cfg['candidate'])]

    def check_run(db, label, left, right, seed, smoke):
        env = candidate_env()
        check_existing_provenance(db, ('smoke-' if smoke else 'model284-')+label, cfg['jobId'], seed,
            dict(sourceCommit=cfg['sourceCommit'], runnerSha256=env['EXPECTED_RUNNER_SHA256'],
                 segmentedBeliefsManifestSha256=env['EXPECTED_BELIEFS_MANIFEST_SHA256'],
                 left=left, right=right, workers=1 if smoke else cfg['workers']))

    def verify_games(base, count, seed):
        for label, left, right in labels:
            path = base/label/'games.db'
            wal = Path(str(path)+'-wal')
            if wal.exists() and wal.stat().st_size:
                raise ValueError('completed database retains an uncheckpointed WAL')
            with sqlite3.connect(path.as_uri()+'?mode=ro&immutable=1', uri=True) as db:
                if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                    raise ValueError('database integrity failure')
                rows = db.execute('SELECT game_index,random_seed,left_engine,right_engine,reproducible,included_in_tables FROM compact_games ORDER BY game_index').fetchall()
                expected = [(i, str(seed+i), left, right, 1, 1) for i in range(count)]
                if rows != expected:
                    raise ValueError('game coverage/paired seed/engine identity mismatch: '+label)
                check_run(db, label, left, right, seed, base.name == 'smoke')

    if mode == 'prepare':
        run([python, source/'scripts/prepare_model284_role_benchmark.py',
             '--sweep', root/'sweep', '--output', output/'beliefs', '--model-root', source])
    elif mode == 'build':
        run([python, source/'scripts/build_rust_release.py', 'benchmark', '--compact', '--offline',
             '--root', source, '--model-root', source, '--target-dir', root/'target',
             '--model', cfg['candidate'], '--model', cfg['opponent']])
        receipt = json.loads((root/'target/pgo/benchmark/latest.json').read_bytes())
        if receipt['status'] != 'complete':
            raise ValueError('PGO build did not complete')
        shutil.copy2(root/'target/pgo/benchmark/latest.json', output/'build-receipt.json')
    elif mode == 'native-validation':
        env = dict(candidate_env(), CARGO_TARGET_DIR=str(root/'target'))
        run([cfg['cargo'], 'test', '--offline', '--locked', '--manifest-path', source/'rust/Cargo.toml',
             '-p', 'cribbage-shadow-engine', '--lib',
             'model::tests::model284_segmented_profiles_route_both_roles_and_value_legal_choices',
             '--', '--exact', '--ignored', '--test-threads=1'], env=env)
        save(output/'native-validation.json', dict(complete=True, profiles=4, roles=2,
                                                 manifestSha256=candidate_env()['EXPECTED_BELIEFS_MANIFEST_SHA256']))
    elif mode == 'smoke' or mode.startswith('games-'):
        smoke = mode == 'smoke'
        base = output/'smoke' if smoke else output/'benchmark'
        count = 1 if smoke else cfg['gamesPerOrientation']
        seed = cfg['smokeSeed'] if smoke else cfg['seed']
        env = candidate_env()
        for number, (label, left, right) in enumerate(labels):
            if not smoke and number != int(mode.split('-')[1]):
                continue
            folder = base/label
            folder.mkdir(parents=True, exist_ok=True)
            dbpath = folder/'games.db'
            indices = []
            if dbpath.exists():
                with sqlite3.connect(dbpath.as_uri()+'?mode=ro', uri=True) as db:
                    check_run(db, label, left, right, seed, smoke)
                    rows = db.execute('SELECT game_index,random_seed,left_engine,right_engine FROM compact_games').fetchall()
                    for i, observed_seed, observed_left, observed_right in rows:
                        if (observed_seed, observed_left, observed_right) != (str(seed+i), left, right):
                            raise ValueError('incompatible completed game on resume')
                    indices = [row[0] for row in rows]
            for low, high in missing_ranges(indices, count):
                run([root/'target/release/cribbage-runner', '--left', left, '--right', right,
                     '--games', high-low, '--start-index', low, '--total-games', count,
                     '--seed', seed, '--workers', 1 if smoke else cfg['workers'],
                     '--model-root', source, '--out-dir', folder, '--db', dbpath,
                     '--run-id', ('smoke-' if smoke else 'model284-')+label,
                     '--matchup-id', cfg['jobId']], env=env)
        if smoke:
            verify_games(base, count, seed)
            save(output/'smoke-verified.json', dict(complete=True, games=2))
    elif mode == 'verify-games':
        verify_games(output/'benchmark', cfg['gamesPerOrientation'], cfg['seed'])
        save(output/'game-integrity.json', dict(complete=True,
            games=2*cfg['gamesPerOrientation'], pairedSeeds=True,
            runnerSha256=sha(root/'target/release/cribbage-runner'),
            manifestSha256=candidate_env()['EXPECTED_BELIEFS_MANIFEST_SHA256']))
    elif mode == 'manifest':
        folder = output/'benchmark'
        folder.mkdir(exist_ok=True)
        manifest = dict(experiment='role-separated early/late beliefs; dealer early<=109, pone early<=111; unchanged discard correction',
            candidate=cfg['candidate'], opponent=cfg['opponent'], sourceCommit=cfg['sourceCommit'],
            seed=cfg['seed'], gamesPerOrientation=cfg['gamesPerOrientation'], totalGames=2*cfg['gamesPerOrientation'],
            workers=cfg['workers'], orientationPairing='same seeds/deals, reciprocal seats, alternating initial dealer',
            runnerSha256=sha(root/'target/release/cribbage-runner'),
            beliefsManifestSha256=candidate_env()['EXPECTED_BELIEFS_MANIFEST_SHA256'])
        (folder/'manifest.txt').write_text(''.join(f'{k}={v}\n' for k, v in manifest.items()))
    elif mode == 'report':
        base = output/'benchmark'
        run([python, source/'scripts/report_paired_benchmark.py', '--candidate-left-db', base/'28.4-left/games.db',
             '--opponent-left-db', base/'ace-left/games.db', '--candidate', cfg['candidate'],
             '--opponent', cfg['opponent'], '--expected-games', cfg['gamesPerOrientation'],
             '--output', base/'paired-summary.json'])
        command = [node, '--no-warnings', source/'scripts/report-paired-live-benchmark.cjs',
                   '--root', base, '--candidate', cfg['candidate'], '--opponent', cfg['opponent'],
                   '--candidate-left', '28.4-left', '--opponent-left', 'ace-left',
                   '--candidate-left-run-id', 'model284-28.4-left', '--opponent-left-run-id', 'model284-ace-left']
        for fmt, name in [('json', 'full-report.json'), ('markdown', 'full-report.md')]:
            with (base/name).open('w') as stream:
                run(command+['--format', fmt], stdout=stream)
        save(output/'reported.json', dict(complete=True))
    elif mode == 'sync':
        destination = Path(cfg['durableRoot'])
        destination.mkdir(parents=True, exist_ok=True)
        # Freeze WAL contents before the read-only durable verification.
        for path in output.rglob('games.db'):
            with sqlite3.connect(path) as db:
                db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        run(['/usr/bin/rsync', '-a', str(output)+'/', str(destination)+'/'])
        for name in ('experiment.json', 'frozen-inputs.json', 'job.json'):
            shutil.copy2(root/name, destination/name)
        shutil.copytree(source/'scripts', destination/'scripts', dirs_exist_ok=True)
    elif mode == 'verify-sync':
        destination = Path(cfg['durableRoot'])
        verify_games(destination/'benchmark', cfg['gamesPerOrientation'], cfg['seed'])
        for path in output.rglob('*'):
            if path.is_file() and path.suffix not in ('.db-shm', '.db-wal'):
                copy = destination/path.relative_to(output)
                if not copy.is_file() or sha(copy) != sha(path):
                    raise ValueError('durable result differs: '+str(path.relative_to(output)))
        save(root/'durable-verified.json', dict(complete=True, durableRoot=str(destination)))
    else:
        raise ValueError('unknown stage '+mode)


if __name__ == '__main__':
    main()
