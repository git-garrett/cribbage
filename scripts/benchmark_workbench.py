#!/usr/bin/env python3
"""Read-only, on-demand browser workbench for the one-shot benchmark supervisor."""

from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import threading
import time
from urllib.parse import parse_qs, urlsplit

from benchmark_workbench_stats import METRICS, metric_histories, paired_history


RUNTIME = Path('/private/tmp/strong-cribbage-local-runtime/workbench')
JOBS_RUNTIME = Path('/private/tmp/cribbage-jobs')
STATIC = Path(__file__).resolve().parent / 'benchmark-workbench'
PORT = 8766
CACHE_SECONDS = 15


def read_json(path, fallback=None):
    try:
        value = json.loads(Path(path).read_text())
        return value if isinstance(value, dict) else fallback
    except (OSError, ValueError):
        return fallback


def manifest(root):
    try:
        return dict(line.split('=', 1) for line in (root / 'manifest.txt').read_text().splitlines() if '=' in line)
    except OSError:
        return {}


def benchmark_root(spec):
    if spec.get('benchmarkRoot'):
        return Path(spec['benchmarkRoot']).resolve()
    # Later sync stages can check a second, durable copy of the same databases.
    # Observe the first database contract, never its subsequent archive copy.
    for stage in spec.get('stages', []):
        roots = {Path(check['path']).resolve().parent.parent
                 for check in stage.get('completionChecks', [])
                 if check.get('table') == 'compact_games' and check.get('path')}
        if roots:
            return next(iter(roots)) if len(roots) == 1 else None
    return None


def job_entry(spec_path):
    spec_path = Path(spec_path).resolve()
    spec = read_json(spec_path)
    if not spec or not re.fullmatch('[a-z0-9-]+', spec.get('jobId', '')):
        raise ValueError('A valid job specification is required')
    root = benchmark_root(spec)
    if root is None:
        return None
    return {'id': spec['jobId'], 'root': str(root), 'spec': str(spec_path)}


def register(spec_path, runtime=RUNTIME):
    entry = job_entry(spec_path)
    if entry is None:
        return None
    directory = runtime / 'jobs'
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / (entry['id'] + '.json')
    temporary = destination.with_suffix('.tmp')
    temporary.write_text(json.dumps(entry) + '\n')
    temporary.replace(destination)
    return entry


def job_status(entry):
    spec = read_json(entry['spec'], {})
    root = Path(spec.get('jobRoot', '/private/tmp/cribbage-jobs/' + entry['id']))
    return read_json(root / 'status.json', {})


def list_jobs(runtime=RUNTIME, jobs_runtime=JOBS_RUNTIME):
    entries = {}
    for path in (runtime / 'jobs').glob('*.json'):
        entry = read_json(path)
        if entry:
            entries[entry['id']] = entry
    # Older frozen supervisors do not have the registration hook. Discovery is
    # read-only and reads only small specs/status files, not game databases.
    for path in jobs_runtime.glob('*/job.json'):
        try:
            entry = job_entry(path)
        except (OSError, ValueError):
            continue
        if entry:
            entries[entry['id']] = entry
    jobs = []
    for entry in entries.values():
        info = manifest(Path(entry['root']))
        status = job_status(entry)
        jobs.append({**entry, 'candidate': info.get('candidate'), 'opponent': info.get('opponent') or info.get('baseline'),
                     'state': status.get('state', 'unavailable'), 'updatedAt': status.get('updatedAt', '')})
    # A resume changes the supervisor ID, not the experiment's databases.
    # Keep the active/latest supervisor and resolve old bookmarks to it.
    experiments = {}
    for job in sorted(jobs, key=lambda x: (x['state'] == 'running', x['updatedAt']), reverse=True):
        root = str(Path(job['root']).resolve())
        if root in experiments:
            experiments[root]['aliases'].append(job['id'])
        else:
            experiments[root] = {**job, 'root': root, 'aliases': []}
    return list(experiments.values())


def timestamp(value):
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    except (ValueError, AttributeError, TypeError):
        return None


def game_metrics(db, games, cache):
    """Summarize only newly completed games, using indexed game-id lookups.

    The runner commits a game and its telemetry atomically. Completed records
    are immutable within a frozen run; changed game metadata invalidates a row.
    The cache holds sums/counts, never per-decision records or connections.
    """
    columns = {table: {row[1] for row in db.execute(f'PRAGMA table_info({table})')}
               for table in ('compact_hands', 'compact_discards', 'compact_peg_plays')}
    schema = tuple((table, tuple(sorted(names))) for table, names in columns.items())
    missing = []
    for game in games:
        signature = (schema, tuple(game.items()))
        cached = cache.get(game['game_id'])
        if cached and cached[0] == signature:
            game['metrics'] = cached[1]
        else:
            game['metrics'] = {key: [[0.0] * 4, [0.0] * 4] for key in METRICS}
            missing.append((game, signature))

    def add(game, key, side, value, predicted=0, actual=0):
        if (not isinstance(value, (float, int)) or not math.isfinite(value)
                or (value < 0 and not key.startswith('wp_'))):
            raise ValueError(f'Invalid {key} telemetry in game {game["game_index"]}')
        target = game['metrics'][key][side]
        for i, amount in enumerate((value, 1, predicted, actual)):
            target[i] += amount

    def actor(game, row):
        player = row['player']
        if player not in (0, 1) or row['role'] not in (0, 1) or row['model'] is None:
            return None
        expected = game['left_engine'] if player == 0 else game['right_engine']
        if row['model'] != expected:
            raise ValueError(f'Telemetry engine mismatch in game {game["game_index"]}')
        return player

    for start in range(0, len(missing), 100):
        batch = missing[start:start + 100]
        by_id = {game['game_id']: game for game, _ in batch}
        placeholders = ','.join('?' for _ in batch)

        def rows(table, fields, order=''):
            if not set(fields) <= columns[table]:
                return []
            return db.execute(f'SELECT {",".join(fields)} FROM {table} '
                              f'WHERE game_id IN ({placeholders}) {order}', tuple(by_id)).fetchall()

        fields = ['game_id', 'dealer', 'left_pegging_points', 'right_pegging_points',
                  'left_hand_points', 'right_hand_points', 'crib_points']
        for row in rows('compact_hands', fields):
            game = by_id[row['game_id']]
            if row['dealer'] not in (0, 1):
                raise ValueError('Invalid dealer in scoring telemetry')
            for side, prefix in enumerate(('left', 'right')):
                role = 'dealer' if side == row['dealer'] else 'pone'
                add(game, f'peg_{role}', side, row[f'{prefix}_pegging_points'] or 0)
                add(game, f'hand_{role}', side, row[f'{prefix}_hand_points'] or 0)
            add(game, 'crib', row['dealer'], row['crib_points'] or 0)

        for kind, table in (('discard', 'compact_discards'), ('pegging', 'compact_peg_plays')):
            fields = ['game_id', 'player', 'role', 'model', 'selected_win_probability']
            if kind == 'pegging':
                fields += ['action', 'legal_count']
            for row in rows(table, fields):
                game = by_id[row['game_id']]
                side = actor(game, row)
                prediction = row['selected_win_probability']
                if side is None or prediction is None or (kind == 'pegging' and
                        (row['action'] != 0 or (row['legal_count'] or 0) <= 1)):
                    continue
                if not isinstance(prediction, (float, int)) or not math.isfinite(prediction) or not 0 <= prediction <= 1:
                    raise ValueError('Invalid recorded win probability')
                actual = int(game['winner'] == side)
                role = 'dealer' if row['role'] else 'pone'
                add(game, f'wp_{kind}_{role}', side, actual - prediction, prediction, actual)

        seen = set()
        fields = ['game_id', 'hand_number', 'sequence', 'player', 'role', 'model', 'action', 'legal_count', 'decision_elapsed_us']
        for row in rows('compact_peg_plays', fields, 'ORDER BY game_id, hand_number, sequence'):
            if row['action'] != 0 or row['player'] not in (0, 1):
                continue
            key = (row['game_id'], row['hand_number'], row['player'])
            if key in seen:
                continue
            seen.add(key)  # Mark the first card BEFORE excluding forced/missing calls.
            game = by_id[row['game_id']]
            side = actor(game, row)
            elapsed = row['decision_elapsed_us']
            if side is not None and row['role'] == 0 and elapsed is not None and (row['legal_count'] or 0) > 1:
                add(game, 'pone_open', side, elapsed / 1_000_000)

        for game, signature in batch:
            cache[game['game_id']] = (signature, game['metrics'])
    live_ids = {game['game_id'] for game in games}
    for game_id in list(cache):
        if game_id not in live_ids:
            del cache[game_id]


def orientation(root, label, run_id, metric_cache=None):
    if not label or Path(label).name != label or label in ('.', '..'):
        raise ValueError('Manifest must name two orientation directories')
    status = read_json(root / label / 'status.json', {})
    path = root / label / 'games.db'
    if not path.is_file():
        return [], status, run_id
    # No VACUUM, copy, writes, or persistent connection.
    # WAL readers do not block writers; timeout bounds contention on older DBs.
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=0.15)) as db:
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        if not run_id:
            runs = db.execute('SELECT DISTINCT run_id FROM compact_games').fetchall()
            if len(runs) > 1:
                raise ValueError('Multiple run IDs: specify orientation run IDs in the manifest')
            run_id = runs[0][0] if runs else status.get('runId')
        has_ids = 'game_id' in {row[1] for row in db.execute('PRAGMA table_info(compact_games)')}
        games = [dict(row) for row in db.execute(
            ('SELECT game_id, ' if has_ids else 'SELECT ') +
            'game_index, random_seed, left_engine, right_engine, winner, '
            'final_left_score, final_right_score, started_at, ended_at '
            'FROM compact_games WHERE run_id = ? AND included_in_tables = 1 ORDER BY game_index', (run_id,))]
        if has_ids:
            identity = (str(path), path.stat().st_ino, run_id)
            cache = metric_cache.setdefault(identity, {}) if metric_cache is not None else {}
            game_metrics(db, games, cache)
    if status.get('runId') != run_id:
        status = {}
    return games, status, run_id


def report_arguments(info):
    args = {}
    try:
        command = json.loads(info.get('reportCommand', '[]'))
        args = {command[i]: command[i + 1] for i in range(len(command) - 1) if command[i].startswith('--')}
    except (ValueError, TypeError, AttributeError):
        pass
    return args


def config(info):
    args = report_arguments(info)
    return [info.get('candidateLeftRunId') or args.get('--candidate-left-run-id'),
            info.get('opponentLeftRunId') or args.get('--opponent-left-run-id')]



def resolve_manifest(entry):
    """Read legacy manifests without modifying a frozen experiment."""
    root = Path(entry['root'])
    info = manifest(root)
    info.setdefault('opponent', info.get('baseline'))
    args = report_arguments(info)
    for field, flag in [('candidateLeft', '--candidate-left'), ('opponentLeft', '--opponent-left')]:
        if not info.get(field) and args.get(flag):
            info[field] = args[flag]
    if all(info.get(field) for field in ('candidateLeft', 'opponentLeft')):
        return info
    if not info.get('candidate') or not info.get('opponent'):
        return info
    spec = read_json(entry['spec'], {})
    paths = {Path(check['path']).resolve() for stage in spec.get('stages', [])
             for check in stage.get('completionChecks', [])
             if check.get('table') == 'compact_games' and check.get('path')}
    if not paths:
        paths = set(root.glob('*/games.db'))
    inferred = {}
    for path in sorted(paths):
        if path.parent.parent != root or path.name != 'games.db':
            continue
        status = read_json(path.parent / 'status.json', {})
        engines = (status.get('left'), status.get('right'))
        if not all(engines) and path.is_file():
            with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=.15)) as db:
                identities = db.execute('SELECT DISTINCT left_engine, right_engine FROM compact_games LIMIT 2').fetchall()
            if len(identities) != 1:
                continue
            engines = identities[0]
        field = ('candidateLeft' if engines == (info['candidate'], info['opponent']) else
                 'opponentLeft' if engines == (info['opponent'], info['candidate']) else None)
        if field:
            if field in inferred and inferred[field] != path.parent.name:
                raise ValueError('Ambiguous orientation directories; record labels in the manifest')
            inferred[field] = path.parent.name
    for field, value in inferred.items():
        info.setdefault(field, value)
    return info


def inspect_games(games, candidate, opponent, side, target, start):
    indexed = {}
    for game in games:
        index = game['game_index']
        if index in indexed:
            raise ValueError(f'Duplicate game index {index}; cannot pair multiple matchups')
        if not isinstance(index, int) or not start <= index < start + target:
            raise ValueError(f'Game index {index} is outside the contracted interval')
        if (game['left_engine'], game['right_engine']) != ((candidate, opponent) if side == 0 else (opponent, candidate)):
            raise ValueError(f'Engine mismatch at index {index}')
        if game['winner'] not in (0, 1) or any(not isinstance(game[key], int) for key in ('final_left_score', 'final_right_score')):
            raise ValueError(f'Incomplete outcome at index {index}')
        indexed[index] = game
    return indexed


def progress_history(games):
    ends = sorted(t for g in games if (t := timestamp(g['ended_at'])) is not None)
    starts = [t for g in games if (t := timestamp(g['started_at'])) is not None]
    if not ends or not starts:
        return []
    start = min(starts)
    stride = max(1, math.ceil(len(ends) / 200))
    result = []
    for i, end in enumerate(ends, 1):
        if i == 1 or i % stride == 0 or i == len(ends):
            hours = max(0, (end - start) / 3600)
            result.append({'hours': hours, 'games': i, 'gamesPerHour': i / hours if hours else None})
    return result


def build_report(entry, now=None, metric_cache=None):
    started = time.monotonic()
    now = time.time() if now is None else now
    root = Path(entry['root'])
    info = resolve_manifest(entry)
    job = job_status(entry)
    stages = [{'name': s.get('name'), 'state': s.get('state')} for s in job.get('stages', [])]
    result = {'id': entry['id'], 'root': str(root), 'state': job.get('state', 'unavailable'),
              'stages': stages, 'asOf': datetime.fromtimestamp(now, timezone.utc).isoformat(),
              'candidate': info.get('candidate'), 'opponent': info.get('opponent')}
    if not all(info.get(k) for k in ('candidate', 'opponent', 'candidateLeft', 'opponentLeft', 'gamesPerOrientation')):
        return {**result, 'waiting': 'Waiting for the paired benchmark manifest.'}
    candidate, opponent = info['candidate'], info['opponent']
    target = int(info['gamesPerOrientation'])
    start = int(info.get('startIndex', 0))
    if target <= 0 or start < 0:
        raise ValueError('Manifest must specify a positive target and nonnegative startIndex')
    data = [orientation(root, label, run_id, metric_cache) for label, run_id in zip(
        (info['candidateLeft'], info['opponentLeft']), config(info))]
    indexed = [inspect_games(rows, candidate, opponent, i, target, start) for i, (rows, _, _) in enumerate(data)]
    matches = sorted(indexed[0].keys() & indexed[1].keys())
    for index in matches:
        if not indexed[0][index]['random_seed'] or indexed[0][index]['random_seed'] != indexed[1][index]['random_seed']:
            raise ValueError(f'Paired seed mismatch at index {index}')
    if info.get('seed'):
        seed = int(info['seed'], 0)
        for orientation_games in indexed:
            for index, game in orientation_games.items():
                if str(game['random_seed']) != str((seed + index) % (2 ** 32)):
                    raise ValueError(f'Seed mismatch with the manifest at index {index}')
    # Only a fixed-order contiguous prefix can enter sequential inference.
    # Skipping a slow unfinished game could select outcomes by game duration.
    pairs = []
    index = start
    while index in indexed[0] and index in indexed[1]:
        pairs.append((indexed[0][index], indexed[1][index]))
        index += 1
    history = paired_history(pairs)
    orientations = []
    remaining = []
    warnings = []
    for side, (rows, status, run_id) in enumerate(data):
        count = len(rows)
        state = status.get('status', 'waiting')
        if result['state'] in ('stopped', 'failed'):
            state = result['state']
        elif count == target:
            state = 'complete'
        elif state == 'complete':
            state = 'snapshot incomplete'
        age = now - (timestamp(status.get('updatedAt')) or 0)
        stale = state == 'running' and age > 300
        if stale:
            warnings.append(f"{('Candidate left', 'Opponent left')[side]} has no update in the last five minutes.")
        rate = status.get('gamesPerSecond')
        rate = rate if isinstance(rate, (float, int)) and math.isfinite(rate) and rate > 0 else None
        eta = (target - count) / rate if rate and state == 'running' and not stale else (0 if count == target else None)
        remaining.append(eta)
        wins = sum(g['winner'] == side for g in rows)
        orientations.append({'label': (info['candidateLeft'], info['opponentLeft'])[side],
                             'saved': count, 'target': target, 'state': state, 'stale': stale,
                             'winRate': wins / count if count else None, 'candidateWins': wins,
                             'runId': run_id, 'updatedAt': status.get('updatedAt'), 'workers': status.get('workers'),
                             'gamesPerHour': rate * 3600 if rate else None})
    saved = sum(x['saved'] for x in orientations)
    wins = sum(x['candidateWins'] for x in orientations)
    elapsed = max(remaining) if all(x is not None for x in remaining) else None
    latest = history[-1] if history else None
    result.update({
        'experiment': info.get('experiment', entry['id']), 'sourceCommit': info.get('sourceCommit'),
        'seed': info.get('seed'), 'compiler': info.get('compiler'), 'timingNote': info.get('timingNote'),
        'saved': saved, 'target': target * 2, 'rawWinRate': wins / saved if saved else None,
        'candidateWins': wins, 'opponentWins': saved - wins,
        'orientations': orientations, 'remainingSeconds': elapsed,
        'estimatedCompletion': datetime.fromtimestamp(now + elapsed, timezone.utc).isoformat() if elapsed else None,
        'matchedPairs': len(matches), 'orderedPairs': len(pairs), 'pendingPairs': len(matches) - len(pairs),
        'history': history, 'latest': latest, 'progressHistory': progress_history(data[0][0] + data[1][0]),
        'metrics': metric_histories(pairs),
        'warnings': warnings, 'integrity': 'passed',
        'readMilliseconds': round((time.monotonic() - started) * 1000, 1),
    })
    return result


class WorkbenchServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, runtime=RUNTIME, lan_hostname=None):
        super().__init__(address, Handler)
        self.runtime = runtime
        self.cache = {}
        self.metric_cache = {}
        self.cache_lock = threading.Lock()
        self.allowed_hosts = {f'127.0.0.1:{self.server_port}', f'localhost:{self.server_port}'}
        if lan_hostname:
            self.allowed_hosts.add(f'{lan_hostname.lower()}:{self.server_port}')

    def report(self, entry):
        with self.cache_lock:
            cached = self.cache.get(entry['id'])
            if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
                return cached[1]
            try:
                report = build_report(entry, metric_cache=self.metric_cache)
            except (OSError, ValueError, sqlite3.Error) as error:
                report = {'id': entry['id'], 'error': str(error), 'integrity': 'unavailable',
                          'asOf': datetime.now(timezone.utc).isoformat()}
            self.cache[entry['id']] = (time.monotonic(), report)
            return report


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def respond(self, value, status=200, content_type='application/json'):
        body = json.dumps(value, allow_nan=False).encode() if content_type == 'application/json' else value
        self.send_response(status)
        self.send_header('Content-Type', content_type + '; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # Reject DNS rebinding and cross-origin access to local experiment data.
        if self.headers.get('Host', '').lower() not in self.server.allowed_hosts:
            return self.respond({'error': 'Unknown workbench address'}, 403)
        url = urlsplit(self.path)
        if url.path == '/health':
            return self.respond({'service': 'cribbage-benchmark-workbench', 'version': 1})
        jobs = None
        if url.path in ('/api/jobs', '/api/report'):
            jobs = list_jobs(self.server.runtime)
        if url.path == '/api/jobs':
            return self.respond({'jobs': jobs, 'refreshSeconds': CACHE_SECONDS})
        if url.path == '/api/report':
            selected = parse_qs(url.query).get('job', [''])[0]
            entry = next((job for job in jobs
                          if job['id'] == selected or selected in job['aliases']), None)
            if not entry:
                return self.respond({'error': 'Unknown benchmark'}, 404)
            return self.respond(self.server.report(entry))
        files = {'/favicon.svg': ('favicon.svg', 'image/svg+xml'), '/': ('index.html', 'text/html'), '/app.js': ('app.js', 'text/javascript'), '/style.css': ('style.css', 'text/css')}
        if url.path in files:
            filename, content_type = files[url.path]
            return self.respond((STATIC / filename).read_bytes(), content_type=content_type)
        return self.respond({'error': 'Not found'}, 404)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('register', 'serve'))
    parser.add_argument('spec', nargs='?')
    parser.add_argument('--lan-hostname', help='Mac Bonjour hostname ending in .local; enables LAN access')
    args = parser.parse_args()
    if args.action == 'register':
        if not args.spec:
            parser.error('register requires a job specification')
        entry = register(args.spec)
        if entry:
            print(f"http://127.0.0.1:{PORT}/?job={entry['id']}")
        return
    os.nice(10)
    if args.lan_hostname and not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.local', args.lan_hostname):
        parser.error('--lan-hostname must be a Bonjour name ending in .local')
    bind = '0.0.0.0' if args.lan_hostname else '127.0.0.1'
    WorkbenchServer((bind, PORT), lan_hostname=args.lan_hostname).serve_forever(poll_interval=0.5)


if __name__ == '__main__':
    main()
