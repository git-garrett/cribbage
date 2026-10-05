#!/usr/bin/env python3
"""Stop explicitly listed jobs only at the workbench's sequential win boundary."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import time

from benchmark_workbench import build_report, job_entry
from cribbage_job_queue import atomic_json, load_spec, read_status


def winner(report):
    latest = report.get('latest')
    if report.get('integrity') != 'passed' or not latest:
        return None
    if latest['pairs'] != report['orderedPairs'] or latest['pairs'] < 1:
        raise ValueError('Sequential inference must use the complete ordered prefix')
    low, high = latest['anytime95']
    return 'candidate' if low > .5 else ('opponent' if high < .5 else None)


def check(spec_path, output):
    spec = load_spec(spec_path)
    status = read_status(spec)
    record = {'spec': str(spec_path), 'jobId': spec['jobId'], 'state': status['state']}
    if status['state'] not in ('running', 'complete'):
        return record
    entry = job_entry(spec_path)
    if entry is None:
        raise ValueError('Expected a paired benchmark specification')
    report = build_report(entry)
    record.update(candidate=report['candidate'], opponent=report['opponent'],
                  latest=report['latest'], orderedPairs=report['orderedPairs'])
    selected = winner(report)
    if selected and status['state'] == 'running':
        directory = output / spec['jobId']
        directory.mkdir(parents=True, exist_ok=True)
        record.update(reason='95% paired confidence sequence excludes 50%', winner=selected,
                      stoppedAt=datetime.now(timezone.utc).isoformat())
        atomic_json(directory / 'decision.json', record)
        # Stop the canonical supervisor, never infer or signal a worker PID.
        subprocess.run([sys.executable, str(Path(__file__).with_name('cribbage_job_queue.py')),
                        'stop', str(spec_path)], check=True, stdout=subprocess.DEVNULL)
        record['state'] = read_status(spec)['state']
        if record['state'] != 'stopped':
            raise RuntimeError('Supervisor did not confirm a stopped job')
        # Backups preserve saved out-of-order games as well as the inference prefix.
        receipts = []
        for source in sorted(Path(entry['root']).glob('*/games.db')):
            target = directory / (source.parent.name + '.db')
            with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as src:
                with sqlite3.connect(target) as dst:
                    src.backup(dst)
                    if dst.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                        raise RuntimeError('Stopped benchmark backup failed integrity')
                    n = dst.execute('SELECT count(*) FROM compact_games').fetchone()[0]
            h = hashlib.sha256()
            with target.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''): h.update(chunk)
            receipts.append({'path': str(target), 'games': n, 'sha256': h.hexdigest()})
        atomic_json(directory / 'preserved.json', {'status': 'complete', 'databases': receipts})
        atomic_json(directory / 'decision.json', record)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', type=Path)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    output = Path(config['output'])
    output.mkdir(parents=True, exist_ok=True)
    while True:
        rows = [check(Path(spec).resolve(), output) for spec in config['specs']]
        done = all(r['state'] in ('complete', 'stopped') for r in rows)
        atomic_json(output / 'status.json', {'status': 'complete' if done else 'running',
                    'updatedAt': datetime.now(timezone.utc).isoformat(), 'jobs': rows})
        if done or args.once:
            return
        if any(r['state'] == 'failed' for r in rows):
            raise RuntimeError('A watched benchmark failed; preserving its state')
        time.sleep(60)


if __name__ == '__main__':
    main()
