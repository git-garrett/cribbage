#!/usr/bin/env python3
"""Frozen 10k follow-up, stopping only at the paired anytime-valid 95% boundary."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys

from benchmark_workbench_stats import BETS, confidence_sequence
from cribbage_job_queue import atomic_json
from model284_role_benchmark_stage import check_existing_provenance, missing_ranges, sha

METHOD = 'paired-fixed-bet-mixture-v1'
LABELS = ('28.4-left', 'ace-left')


def decision(counts, maximum):
    if len(counts) != 3 or any(type(n) is not int or n < 0 for n in counts):
        raise ValueError('invalid paired outcome counts')
    pairs = sum(counts)
    if not 0 <= pairs <= maximum:
        raise ValueError('invalid paired sample size')
    low, high = confidence_sequence(counts)
    winner = 'candidate' if low > .5 else 'opponent' if high < .5 else None
    return dict(method=METHOD, pairs=pairs, maximumGames=2*maximum, alpha=.05,
                bets=list(BETS), anytime95=[low, high], winner=winner,
                finished=bool(winner or pairs == maximum),
                reason='confidence_boundary' if winner else 'game_cap' if pairs == maximum else 'continue',
                candidateSweeps=counts[2], splits=counts[1], opponentSweeps=counts[0])


def outcome_counts(left, right, prefix):
    if len(left) < prefix or len(right) < prefix:
        raise ValueError('both orientations must cover the requested ordered prefix')
    counts = [0, 0, 0]
    for index in range(prefix):
        a, b = left[index], right[index]
        if a['game_index'] != index or b['game_index'] != index or a['random_seed'] != b['random_seed']:
            raise ValueError('paired inference requires a complete ordered matching seed prefix')
        if a['winner'] not in (0, 1) or b['winner'] not in (0, 1):
            raise ValueError('missing decisive winner')
        counts[int(a['winner'] == 0)+int(b['winner'] == 1)] += 1
    return counts


def main():
    root, mode = Path(sys.argv[1]).resolve(), sys.argv[2]
    cfg = json.loads((root/'experiment.json').read_bytes())
    for name, expected in json.loads((root/'frozen-inputs.json').read_bytes()).items():
        if sha(root/name) != expected:
            raise ValueError('frozen input changed: '+name)
    maximum, batch = cfg['maximumPairs'], cfg['batchPairs']
    if maximum != 5000 or batch != 100 or cfg['workersPerOrientation'] != 3:
        raise ValueError('sequential contract differs from 10k/200-game checkpoints/six total workers')
    if cfg['method'] != METHOD or cfg['bets'] != list(BETS) or cfg['alpha'] != .05:
        raise ValueError('sequential method differs from its frozen protocol')
    output = root/'output'
    base = output/'benchmark'
    output.mkdir(exist_ok=True)
    base.mkdir(exist_ok=True)
    env = dict(os.environ)
    for name in ('CRIBBAGE_284_BELIEFS_MANIFEST', 'EXPECTED_BELIEFS_MANIFEST_SHA256',
                 'CRIBBAGE_284_CORRECTIONS_MANIFEST', 'CRIBBAGE_283_FAST_ASSET'):
        env.pop(name, None)
    env.update(SOURCE_COMMIT=cfg['engineSourceCommit'],
        EXPECTED_RUNNER_SHA256=cfg['runnerSha256'],
        CRIBBAGE_284_BELIEFS_MANIFEST=str(root/'beliefs/manifest.json'),
        EXPECTED_BELIEFS_MANIFEST_SHA256=cfg['beliefsManifestSha256'])
    latest_path = base/'sequential.json'
    latest = json.loads(latest_path.read_bytes()) if latest_path.exists() else None

    def rows(number):
        label = LABELS[number]
        path = base/label/'games.db'
        if not path.exists():
            return []
        with sqlite3.connect(path.as_uri()+'?mode=ro', uri=True) as db:
            db.row_factory = sqlite3.Row
            left, right = ((cfg['candidate'], cfg['opponent']) if number == 0
                           else (cfg['opponent'], cfg['candidate']))
            # The helper compares tuple rows, not sqlite.Row objects.
            db.row_factory = None
            check_existing_provenance(db, 'model284-seq-'+label, cfg['jobId'], cfg['seed'],
                dict(sourceCommit=cfg['engineSourceCommit'], runnerSha256=cfg['runnerSha256'],
                     segmentedBeliefsManifestSha256=cfg['beliefsManifestSha256'],
                     left=left, right=right, workers=cfg['workersPerOrientation']))
            db.row_factory = sqlite3.Row
            result = [dict(row) for row in db.execute(
                'SELECT game_index,random_seed,left_engine,right_engine,winner,reproducible,included_in_tables '
                'FROM compact_games ORDER BY game_index')]
            for row in result:
                index = row['game_index']
                if (not 0 <= index < maximum or row['random_seed'] != str(cfg['seed']+index)
                    or (row['left_engine'], row['right_engine']) != (left, right)
                    or row['reproducible'] != 1 or row['included_in_tables'] != 1
                    or row['winner'] not in (0, 1)):
                    raise ValueError('invalid saved game identity')
            return result

    def prefix(count):
        values = [rows(i) for i in (0, 1)]
        if any(len(side) != count for side in values):
            raise ValueError('orientation count differs from the checkpoint contract')
        return values, outcome_counts(*values, count)

    def manifest(actual=maximum):
        values = dict(experiment='fresh role-segmented Ace confirmation with anytime-valid stopping',
            candidate=cfg['candidate'], opponent=cfg['opponent'], sourceCommit=cfg['engineSourceCommit'],
            orchestratorSourceCommit=cfg['orchestratorSourceCommit'], seed=cfg['seed'],
            candidateLeft=LABELS[0], opponentLeft=LABELS[1],
            candidateLeftRunId='model284-seq-'+LABELS[0], opponentLeftRunId='model284-seq-'+LABELS[1],
            gamesPerOrientation=actual, totalGames=2*actual, maximumGames=2*maximum,
            workersPerOrientation=cfg['workersPerOrientation'], stoppingRule=METHOD,
            orientationPairing='same fresh seeds/deals; reciprocal seats; alternating initial dealer',
            runnerSha256=cfg['runnerSha256'], beliefsManifestSha256=cfg['beliefsManifestSha256'])
        (base/'manifest.txt').write_text(''.join(f'{k}={v}\n' for k,v in values.items()))

    def run_side(number, target):
        label = LABELS[number]
        folder = base/label
        folder.mkdir(exist_ok=True)
        saved = rows(number)
        # Resumes enumerate every hole, preserving higher out-of-order commits.
        for low, high in missing_ranges([r['game_index'] for r in saved], target):
            left, right = ((cfg['candidate'], cfg['opponent']) if number == 0
                           else (cfg['opponent'], cfg['candidate']))
            subprocess.run([str(root/'bin/cribbage-runner'), '--left', left, '--right', right,
                '--games', str(high-low), '--start-index', str(low), '--total-games', str(maximum),
                '--seed', str(cfg['seed']), '--workers', str(cfg['workersPerOrientation']),
                '--model-root', str(root/'model-root'), '--out-dir', str(folder),
                '--db', str(folder/'games.db'), '--run-id', 'model284-seq-'+label,
                '--matchup-id', cfg['jobId']], env=env, cwd=root, check=True)

    if mode == 'preflight':
        if sha(root/'bin/cribbage-runner') != cfg['runnerSha256'] or sha(root/'beliefs/manifest.json') != cfg['beliefsManifestSha256']:
            raise ValueError('engine or belief identity differs from the validated pilot')
        for record in ('native-validation.json', 'build-receipt.json'):
            value = json.loads((root/'pilot-provenance'/record).read_bytes())
            if record == 'native-validation.json' and (value.get('complete') is not True or value['manifestSha256'] != cfg['beliefsManifestSha256']):
                raise ValueError('candidate native validation identity differs')
            if record == 'build-receipt.json' and (value['status'] != 'complete' or value['binaries']['cribbage-runner'] != cfg['runnerSha256']):
                raise ValueError('pilot PGO build identity differs')
        manifest()
        if latest is None:
            initial = decision([0, 0, 0], maximum)
            initial['checkpointPairs'] = batch
            atomic_json(latest_path, initial)
        atomic_json(output/'preflight.json', dict(complete=True, freshSeed=cfg['seed'], maximumGames=10000))
    elif mode.startswith(('games-', 'look-')):
        target = int(mode.split('-')[1])
        if not batch <= target <= maximum or target % batch:
            raise ValueError('invalid checkpoint')
        receipt = output/'steps'/(mode+'.json')
        replay_look = bool(mode.startswith('look-') and latest and latest['pairs'] == target)
        if latest and latest['finished'] and not replay_look:
            if target <= latest['pairs']:
                raise ValueError('completed checkpoint must be resumed through its existing completion receipt')
            atomic_json(receipt, dict(complete=True, skipped=True, terminalPairs=latest['pairs']))
            return
        expected_previous = target-batch
        if mode.startswith('games-'):
            if (latest['pairs'] if latest else 0) != expected_previous:
                raise ValueError('missing earlier checkpoint decision')
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(run_side, i, target) for i in (0, 1)]
                for future in futures:
                    future.result()
            prefix(target)
            atomic_json(receipt, dict(complete=True, pairs=target, contiguous=True))
        else:
            if not replay_look and (latest['pairs'] if latest else 0) != expected_previous:
                raise ValueError('look order differs from the frozen protocol')
            _, counts = prefix(target)
            value = decision(counts, maximum)
            value['checkpointPairs'] = batch
            atomic_json(output/'checkpoints'/f'{target:06}.json', value)
            atomic_json(latest_path, value)
            if value['finished']:
                manifest(target)
            atomic_json(receipt, dict(complete=True, **value))
    elif mode == 'verify':
        if not latest or not latest['finished']:
            raise ValueError('no valid terminal checkpoint')
        count = latest['pairs']
        values, _ = prefix(count)
        for n in range(batch, count+1, batch):
            expected = decision(outcome_counts(*values, n), maximum)
            recorded = json.loads((output/'checkpoints'/f'{n:06}.json').read_bytes())
            if any(recorded.get(k) != v for k,v in expected.items()):
                raise ValueError('checkpoint inference changed')
            if n < count and expected['finished']:
                raise ValueError('benchmark continued after a stopping boundary')
        if any(latest.get(k) != v for k,v in expected.items()):
            raise ValueError('final inference differs from checked checkpoints')
        for label in LABELS:
            path = base/label/'games.db'
            with sqlite3.connect(path) as db:
                db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
                if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                    raise ValueError('completed database integrity failure')
        atomic_json(output/'verified.json', dict(complete=True, pairs=count, games=2*count,
            contiguousIndices=[0, count-1], stopping=latest,
            databases={label:sha(base/label/'games.db') for label in LABELS}))
    elif mode == 'report':
        if not latest or not latest['finished']:
            raise ValueError('terminal inference required for final reporting')
        command = [cfg['node'], '--no-warnings', str(root/'scripts/report-paired-live-benchmark.cjs'),
            '--root', str(base), '--candidate', cfg['candidate'], '--opponent', cfg['opponent'],
            '--candidate-left', LABELS[0], '--opponent-left', LABELS[1],
            '--candidate-left-run-id', 'model284-seq-'+LABELS[0], '--opponent-left-run-id', 'model284-seq-'+LABELS[1]]
        for fmt, name in [('json','full-report.json'), ('markdown','full-report.md')]:
            with (base/name).open('w') as stream:
                subprocess.run(command+['--format',fmt], stdout=stream, cwd=root, check=True)
        subprocess.run([cfg['python'], str(root/'scripts/report_paired_benchmark.py'),
            '--candidate-left-db',str(base/LABELS[0]/'games.db'), '--opponent-left-db',str(base/LABELS[1]/'games.db'),
            '--candidate',cfg['candidate'], '--opponent',cfg['opponent'], '--expected-games',str(latest['pairs']),
            '--output',str(base/'paired-summary.json')], cwd=root, check=True)
        atomic_json(output/'reported.json',dict(complete=True))
    elif mode == 'sync':
        destination = Path(cfg['durableRoot'])
        destination.mkdir(parents=True,exist_ok=True)
        subprocess.run(['/usr/bin/rsync','-a',str(output)+'/',str(destination)+'/'],check=True)
        for name in ('experiment.json','job.json','frozen-inputs.json'):
            shutil.copy2(root/name,destination/name)
        for name in ('scripts','pilot-provenance','beliefs'):
            shutil.copytree(root/name,destination/name,dirs_exist_ok=True)
        atomic_json(root/'synced.json',dict(complete=True))
    elif mode == 'verify-sync':
        destination = Path(cfg['durableRoot'])
        for path in output.rglob('*'):
            if path.is_file() and not path.name.endswith(('-wal','-shm')):
                copied = destination/path.relative_to(output)
                if not copied.is_file() or sha(copied) != sha(path):
                    raise ValueError('durable archive differs: '+str(path.relative_to(output)))
        proof = json.loads((output/'verified.json').read_bytes())
        for label, expected in proof['databases'].items():
            path = destination/'benchmark'/label/'games.db'
            if sha(path) != expected:
                raise ValueError('durable game database differs from verified coverage')
            with sqlite3.connect(path.as_uri()+'?mode=ro&immutable=1',uri=True) as db:
                indices = [r[0] for r in db.execute('SELECT game_index FROM compact_games ORDER BY game_index')]
                if indices != list(range(proof['pairs'])):
                    raise ValueError('durable index coverage differs')
        atomic_json(root/'durable-verified.json',dict(complete=True,pairs=proof['pairs'],games=proof['games']))
    else:
        raise ValueError('unknown stage: '+mode)


if __name__ == '__main__':
    main()
