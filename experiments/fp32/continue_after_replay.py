#!/usr/bin/env python3
"""Hand a precision trial to its larger contract without losing finished work."""
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time

base = Path(__file__).resolve().parent
old_spec = Path(sys.argv[1])
new_root = Path(sys.argv[2])
spec = json.loads(old_spec.read_text())
old_root = Path(spec['jobRoot'])
# This is the unmodified canonical supervisor copy frozen by its installer.
module_spec = importlib.util.spec_from_file_location('queue', old_root / 'cribbage_job_queue.py')
queue = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(queue)

deadline = time.monotonic() + 6 * 3600
while True:
    state = json.loads((old_root / 'status.json').read_text())
    replay = next((s for s in state.get('stages', []) if s['name'] == 'replay'), {})
    if replay.get('state') == 'complete':
        break
    if state.get('state') != 'running' or time.monotonic() > deadline:
        raise RuntimeError('Prior timing replay did not complete; continuation blocked')
    time.sleep(5)
report = json.loads((base / 'matched-observation-report.json').read_text())
if report.get('status') != 'passed' or not (base / 'matched-observation-raw.json').is_file():
    raise RuntimeError('Missing verified timing results')
if state.get('state') == 'running' and queue.stop_job(old_spec) != 0:
    raise RuntimeError('Could not stop the prior writer through the canonical supervisor')
# bootout can take a short time to reap the old process group. Never launch a
# second writer while any part of that group still exists.
for _ in range(100):
    try:
        os.killpg(state['pid'], 0)
    except ProcessLookupError:
        break
    time.sleep(.1)
else:
    raise RuntimeError('Prior process group is still alive')
new_root.mkdir(parents=True, exist_ok=True)
counts = {}
for orientation in ('0', '1'):
    path = base / 'benchmark' / orientation / 'games.db'
    if not path.exists():
        counts[orientation] = 0
        continue
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as source:
        if source.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise RuntimeError('Prior database integrity failure')
        with sqlite3.connect(new_root / f'{orientation}-checkpoint.db') as destination:
            source.backup(destination)
        counts[orientation] = source.execute('SELECT count(*) FROM compact_games').fetchone()[0]
queue.atomic_json(new_root / 'handoff.json', {'status': 'passed', 'preservedGames': counts,
    'priorJob': spec['jobId'], 'replayPreserved': True})
