#!/usr/bin/env python3
"""Frozen precision benchmark stages; called by the one-shot supervisor."""
import concurrent.futures
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import statistics
import subprocess
import sys

BASE = Path(__file__).resolve().parent
CONFIG = None
MODEL = 'schell_table-peg_table-28.3.fast'


def candidate_bits():
    bits = CONFIG.get('candidateBits', 32)
    if bits not in (16, 32):
        raise ValueError('candidate must use FP16 or FP32')
    return bits


def save(name, value):
    path = BASE / name
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    tmp.replace(path)


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def db_rows(path):
    if not path.exists():
        return []
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
        return db.execute('SELECT game_index, random_seed, winner, final_left_score, final_right_score, included_in_tables FROM compact_games ORDER BY game_index').fetchall()


def missing_ranges(indices, count):
    missing = sorted(set(range(count)) - set(indices))
    ranges = []
    for index in missing:
        if ranges and ranges[-1][1] == index:
            ranges[-1][1] += 1
        else:
            ranges.append([index, index + 1])
    return ranges


def environment(trace=None):
    env = dict(os.environ, SOURCE_COMMIT=CONFIG['sourceCommit'])
    # Accelerator shards encode FP64 choices. Both use the executable policy.
    for name in list(env):
        if name.startswith('CRIBBAGE_'):
            env.pop(name)
    if trace:
        env['CRIBBAGE_DECISION_TRACE_DIR'] = str(trace)
    return env


def orientation(scope, orientation, count, workers):
    out = BASE / scope / str(orientation)
    out.mkdir(parents=True, exist_ok=True)
    db = out / 'games.db'
    existing = db_rows(db)
    if db.exists():
        validate_orientation(scope, orientation, count, complete=False)
    binaries = [BASE / 'inputs/ace-f64', BASE / f'inputs/ace-f{candidate_bits()}']
    if orientation:
        binaries.reverse()
    for start, end in missing_ranges([r[0] for r in existing], count):
        command = [str(BASE / 'inputs/runner'), '--left', MODEL, '--right', MODEL,
                   '--left-engine', str(binaries[0]), '--right-engine', str(binaries[1]),
                   '--games', str(end-start), '--start-index', str(start), '--total-games', str(count),
                   '--seed', str(CONFIG['seed']), '--workers', str(workers),
                   '--model-root', str(BASE / 'inputs/model'), '--out-dir', str(out), '--db', str(db),
                   '--run-id', f'{scope}-{orientation}', '--matchup-id', f'ace-f{candidate_bits()}-orientation-{orientation}']
        with (out / 'runner.log').open('a') as log:
            subprocess.run(command, check=True, stdout=log, stderr=subprocess.STDOUT,
                           env=environment(out / 'traces'))
    validate_orientation(scope, orientation, count)
    save(f'{scope}/{orientation}/verified.json', {'status': 'passed', 'games': count})


def validate_orientation(scope, orientation, count, complete=True):
    path = BASE / scope / str(orientation) / 'games.db'
    rows = db_rows(path)
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('database integrity failure')
        if db.execute('SELECT count(*) FROM compact_games WHERE left_engine != ? OR right_engine != ?', (MODEL, MODEL)).fetchone()[0]:
            raise ValueError('unexpected policy model')
        metadata = db.execute('SELECT metadata_json FROM ai_runs WHERE run_id=?', (f'{scope}-{orientation}',)).fetchone()
        expected = [str(BASE / 'inputs/ace-f64'), str(BASE / f'inputs/ace-f{candidate_bits()}')]
        if orientation: expected.reverse()
        if not metadata or json.loads(metadata[0]).get('seatEngines') != expected:
            raise ValueError('seat precision provenance mismatch')
    if any(i < 0 or i >= count for i, *_ in rows):
        raise ValueError('unexpected existing game index')
    if complete and [r[0] for r in rows] != list(range(count)):
        raise ValueError('missing/duplicate game indices')
    for index, seed, winner, left, right, included in rows:
        if int(seed) != (CONFIG['seed'] + index) % 2**32 or included != 0:
            raise ValueError('seed/provenance exclusion mismatch')
        if winner not in (0, 1) or (left >= 121) != (winner == 0) or (right >= 121) != (winner == 1):
            raise ValueError('invalid game outcome')
    return rows


def play(scope, count, workers):
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(orientation, scope, o, count, workers) for o in range(2)]
        for future in futures:
            future.result()
    save(scope + '/verified.json', {'status': 'passed', 'gamesPerOrientation': count})


def verify_inputs():
    for name, expected in CONFIG['hashes'].items():
        if digest(BASE / name) != expected:
            raise ValueError('frozen input changed: ' + name)
    samples = [f'kind=discard;model={MODEL};role=dealer;aiScore=0;humanScore=0;aiHand=0,1,2,16,30,44;turnCard=0',
               f'kind=peg;model={MODEL};role=pone;ownDiscards=1,6;aiHand=4,9;aiTable=0,3;humanTable=2,5;humanHandCount=2;aiScore=119;humanScore=120;turnCard=10;plays=0,2,3,5;count=14;last=human;pegHistory=s0,o2,s3,o5;decisionSeed=123456789']
    for precision in (64, candidate_bits()):
        worker = Worker(precision)
        try:
            for sample in samples:
                worker.decide(json.dumps({'inputText': sample}))
        finally:
            worker.close()
    save('preflight.json', {'status': 'passed', 'files': len(CONFIG['hashes'])})


class Worker:
    def __init__(self, precision):
        env = environment()
        env.update(CRIBBAGE_RUST_MODEL_ROOT=str(BASE / 'inputs/model'), CRIBBAGE_FROZEN_MODEL=MODEL)
        self.precision = precision
        self.process = subprocess.Popen([str(BASE / f'inputs/ace-f{precision}')],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        text=True, env=env)

    def decide(self, request):
        self.process.stdin.write(request + '\n')
        self.process.stdin.flush()
        response = json.loads(self.process.stdout.readline())
        expected_assets = CONFIG.get('candidateAssetBits') if self.precision == candidate_bits() else None
        if (response.get('ok') is not True or response.get('arithmeticBits') != self.precision
                or (expected_assets is not None and response.get('assetBits') != expected_assets)):
            raise ValueError('worker failed or wrong precision: ' + str(response))
        return response

    def close(self):
        self.process.terminate()
        self.process.wait()


def action(response):
    d = response['decision']
    return (d.get('cardIds'), d.get('bestLead'), d.get('action'), d.get('cardId'))


def replay():
    # Preserve complete observed sequences and per-hand cache resets. Include all
    # smoke games and both seats; alternate precision order between repeats.
    traces = sorted((BASE / 'smoke').glob('*/traces/*.jsonl'))
    if not traces:
        raise ValueError('missing smoke observations')
    totals = {'discard': [], 'peg': []}
    for trace in traces:
        requests = [json.loads(line)['request'] for line in trace.read_text().splitlines()]
        workers = {p: Worker(p) for p in (64, 32)}
        try:
            for repeat in range(3):
                for request in requests:
                    kind = 'discard' if 'kind=discard;' in request else 'peg'
                    order = (64, 32) if repeat % 2 == 0 else (32, 64)
                    responses = {p: workers[p].decide(request) for p in order}
                    # First pass loads assets; later complete sequences are warm.
                    if repeat:
                        totals[kind].append({'f64CpuNs': responses[64]['cpuNs'], 'f32CpuNs': responses[32]['cpuNs'],
                                             'f64WallUs': responses[64]['elapsedUs'], 'f32WallUs': responses[32]['elapsedUs'],
                                             'differentAction': action(responses[64]) != action(responses[32])})
        finally:
            for worker in workers.values():
                worker.close()
    result = {}
    for kind, rows in totals.items():
        if not rows:
            raise ValueError('missing replay decision kind')
        result[kind] = {'samples': len(rows), 'differentActions': sum(r['differentAction'] for r in rows),
                        'cpuSpeedupF64OverF32': sum(r['f64CpuNs'] for r in rows) / sum(r['f32CpuNs'] for r in rows),
                        'wallSpeedupF64OverF32': sum(r['f64WallUs'] for r in rows) / sum(r['f32WallUs'] for r in rows)}
    save('matched-observation-raw.json', totals)
    save('matched-observation-report.json', {'status': 'passed', 'results': result,
                                           'scope': 'same CPU observations; warm complete sequences; concurrent asset build'})


def live_speed(timings, games, bits=32):
    results = {}
    for kind in ('discard', 'peg', 'overall'):
        kinds = ('discard', 'peg') if kind == 'overall' else (kind,)
        values = {}
        for precision in (bits, 64):
            rows = [timings[f'f{precision}-{k}'] for k in kinds]
            decisions = sum(row['decisions'] for row in rows)
            micros = sum(row['wallUsIncludingIPC'] for row in rows)
            if decisions <= 0 or micros <= 0:
                raise ValueError('missing live-game timing samples')
            values[f'f{precision}'] = {'decisions': decisions,
                                      'meanDecisionMs': micros / decisions / 1000,
                                      'decisionMsPerGame': micros / games / 1000}
        values[f'perDecisionSpeedupF64OverF{bits}'] = values['f64']['meanDecisionMs'] / values[f'f{bits}']['meanDecisionMs']
        values[f'perGameSpeedupF64OverF{bits}'] = values['f64']['decisionMsPerGame'] / values[f'f{bits}']['decisionMsPerGame']
        results[kind] = values
    return {'source': 'live-games', 'results': results,
            'scope': 'Decision wall time including worker transport and scheduling; paired games with a concurrent asset build. Game paths may differ.'}


def report():
    bits = candidate_bits()
    n = CONFIG['gamesPerOrientation']
    rows = [validate_orientation('benchmark', o, n) for o in range(2)]
    pairs = [((a[2] == 1) + (b[2] == 0))/2 for a, b in zip(*rows)]
    mean = statistics.mean(pairs)
    half = 1.96 * statistics.stdev(pairs) / math.sqrt(n)
    timings = {}
    for o in range(2):
        with sqlite3.connect(BASE / 'benchmark' / str(o) / 'games.db') as db:
            for table, kind in [('compact_discards', 'discard'), ('compact_peg_plays', 'peg')]:
                for player, count, micros in db.execute(f'SELECT player,count(*),sum(decision_elapsed_us) FROM {table} WHERE decision_elapsed_us IS NOT NULL GROUP BY player'):
                    precision = bits if player == 1-o else 64
                    row = timings.setdefault(f'f{precision}-{kind}', {'decisions': 0, 'wallUsIncludingIPC': 0})
                    row['decisions'] += count
                    row['wallUsIncludingIPC'] += micros
    margins = [((a[4]-a[3])+(b[3]-b[4]))/2 for a, b in zip(*rows)]
    paired_margin = statistics.mean(margins)
    margin_half = 1.96 * statistics.stdev(margins) / math.sqrt(n)
    result = {'status': 'passed', 'games': 2*n, 'pairs': n, f'f{bits}WinRate': mean,
              'pairedApprox95CI': [max(0,mean-half), min(1,mean+half)],
              f'f{bits}MeanScoreMargin': paired_margin,
              'pairedScoreMarginApprox95CI': [paired_margin-margin_half, paired_margin+margin_half],
              'pairOutcomes': {f'f{bits}WinsBoth': pairs.count(1.0), 'split': pairs.count(0.5), 'f64WinsBoth': pairs.count(0.0)},
              'liveTiming': timings,
              'precision': CONFIG.get('precision', f'FP{bits} discard and pegging inference; integer game rules'),
              'candidateAssetBits': CONFIG.get('candidateAssetBits', bits),
              'candidateArithmeticBits': bits,
              'speed': live_speed(timings, 2*n, bits)}
    save('report.json', result)
    label = CONFIG.get('candidateLabel', f'Full FP{bits} Ace')
    (BASE / 'report.txt').write_text(f"{label} versus FP64 Ace: {2*n:,} games / {n:,} paired seeds\n"
        f"FP{bits} wins {100*mean:.2f}% (paired approximate 95% CI {100*max(0,mean-half):.2f}–{100*min(1,mean+half):.2f}%).\n"
        f"FP{bits} average score margin: {paired_margin:+.3f}.\n"
        + ''.join(f"{kind}: FP{bits} {values[f'f{bits}']['decisionMsPerGame']:.3f} ms/game; "
                  f"FP64 {values['f64']['decisionMsPerGame']:.3f} ms/game; "
                  f"FP64/FP{bits} {values[f'perGameSpeedupF64OverF{bits}']:.3f}x.\n"
                  for kind, values in result['speed']['results'].items())
        + result['speed']['scope'] + '\nCPU experiment; no GPU speed claim.\n')


if __name__ == '__main__':
    config_path = Path(os.environ.get('FP32_CONFIG_PATH', BASE / 'config.json'))
    CONFIG = json.loads(config_path.read_text())
    expected_config = os.environ.get('EXPECTED_CONFIG_SHA256')
    if expected_config and digest(config_path) != expected_config:
        raise ValueError('frozen configuration changed')
    stage = sys.argv[1]
    if stage == 'verify-inputs': verify_inputs()
    elif stage == 'smoke': play('smoke', 1, 1)
    elif stage == 'benchmark': play('benchmark', CONFIG['gamesPerOrientation'], CONFIG['workersPerOrientation'])
    elif stage == 'verify-results':
        for o in range(2): validate_orientation('benchmark', o, CONFIG['gamesPerOrientation'])
        save('integrity.json', {'status': 'passed'})
    elif stage == 'replay': replay()
    elif stage == 'report': report()
    else: raise ValueError('unknown stage')
