#!/usr/bin/env python3
"""Bounded local workers, verified full archive, then shallow-only publication.

The supervised sync stage drains one chunk at a time. All calculation and mutable
queue state stay on internal disk; only verified output crosses the sync boundary.
"""
import argparse
import concurrent.futures
import csv
import fcntl
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import time

from cribbage_job_queue import atomic_json, load_spec, read_status
from receive_model283_opening import inspect_shard


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()


def coordinates(ranking):
    # Guaranteed first-hand coverage before historical heat. A Jack awards dealer 2.
    seen = set()
    for cut in range(13):
        board = (cut, 0, 2 if cut == 10 else 0)
        seen.add(board)
        yield board
    ranked = [(int(r['pone']), int(r['dealer'])) for r in csv.DictReader(ranking.open())]
    boards = dict.fromkeys(ranked + [(p, d) for p in range(121) for d in range(121)])
    for pone, dealer in boards:
        if not 0 <= pone < 121 or not 0 <= dealer < 121:
            raise ValueError('Invalid ranked board')
        for cut in range(13):
            key = cut, pone, dealer
            if key in seen or (cut == 10 and dealer < 2): continue
            seen.add(key)
            yield key


def available_workers(config):
    reserved = 0
    for job in config.get('benchmarks', []):
        state = read_status(load_spec(Path(job['spec'])))['state']
        if state not in ('complete', 'stopped', 'failed'):
            reserved += job['workers']
    return max(1, min(config['maxWorkers'], (os.cpu_count() or 1) - 2 - reserved))


def memory_slots():
    if sys.platform != 'darwin': return 10
    output = subprocess.run(['/usr/bin/vm_stat'], capture_output=True, text=True, check=True).stdout
    size = re.search(r'page size of (\d+) bytes', output)
    if not size: raise ValueError('Cannot read memory headroom')
    pages = 0
    for key in ['Pages free', 'Pages inactive', 'Pages speculative']:
        match = re.search(re.escape(key) + r':\s+(\d+)', output)
        if match: pages += int(match[1])
    # Reserve 2 GiB of reclaimable memory, allow a conservative 512 MiB per new worker.
    return max(0, (pages * int(size[1]) - 2 * 1024**3) // (512 * 1024**2))


def build(config, index, coord):
    cut, pone, dealer, lead = coord
    run = Path(config['run']) / 'pending' / str(index)
    run.mkdir(parents=True, exist_ok=True)
    receipt = run / 'built.json'
    if receipt.is_file():
        value = json.loads(receipt.read_text())
        for kind in ['full', 'production']:
            if sha(Path(value[kind]['path'])) != value[kind]['sha256']:
                raise ValueError('Retained chunk digest changed')
        return value
    command = [config['binary'], config['assets'], str(run / 'full'), str(cut),
               str(pone), str(dealer), str(lead), str(run / 'production')]
    if config.get('background', False) and sys.platform == 'darwin':
        command = ['/usr/sbin/taskpolicy', '-b', '/usr/bin/nice', '-n', '20'] + command
    env = dict(os.environ, CRIBBAGE_283_BUILD_DEALER_PLAYS='4')
    env.pop('CRIBBAGE_283_FAST_ASSET', None)
    before = time.monotonic()
    with (run / 'worker.log').open('w') as log:
        output = subprocess.run(command, stdout=subprocess.PIPE, stderr=log, text=True, env=env, check=True)
    value = json.loads(output.stdout)
    if value.get('status') != 'passed': raise ValueError('Builder did not verify its output')
    relative = f'cut{cut}/pone{pone}/dealer{dealer}-lead{lead}.bin'
    for kind, depth in [('full', 4), ('production', 2)]:
        row = value[kind]; data = Path(row['path']).read_bytes()
        inspect_shard(data, config['policy'], relative, depth)
        row['sha256'] = hashlib.sha256(data).hexdigest()
    value.update(index=index, relative=relative, elapsed=time.monotonic()-before)
    atomic_json(receipt, value)
    return value


def archive_file(source, target, expected):
    created = []
    parent = target.parent
    while not parent.exists():
        created.append(parent); parent = parent.parent
    target.parent.mkdir(parents=True, exist_ok=True)
    for directory in reversed(created):
        sync_directory(directory.parent)
    if target.exists():
        if sha(target) != expected: raise ValueError('Immutable archive conflict')
        sync_directory(target.parent)
        return
    temporary = target.with_suffix('.copying')
    with source.open('rb') as src, temporary.open('wb') as dst:
        shutil.copyfileobj(src, dst, 1024 * 1024)
        dst.flush(); os.fsync(dst.fileno())
    if sha(temporary) != expected: raise ValueError('Archive copy digest differs')
    os.replace(temporary, target)
    sync_directory(target.parent)


def sync_directory(path):
    """Persist renamed files and new directory entries before releasing a copy."""
    fd = os.open(path, os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)


def sync_chunk(config, value):
    # Explicit final sync for this chunk: no calculation writes on the archive drive.
    archive = Path(config['archive']) / config['policy']
    for kind in ['full', 'production']:
        row = value[kind]
        archive_file(Path(row['path']), archive / kind / value['relative'], row['sha256'])
    remote = config.get('remote')
    if remote:
        row = value['production']
        command = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
                   '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
                   '-o', 'ControlMaster=auto', '-o', 'ControlPersist=60',
                   '-o', 'ControlPath=' + str(Path(config['run']) / 'ssh-control'),
                   '-i', remote['key'], remote['host'], 'python3', remote['receiver'],
                   config['policy'], value['relative'], row['sha256']]
        with Path(row['path']).open('rb') as data:
            # Failed publication preserves this completed chunk for an explicit resume.
            out = subprocess.run(command, stdin=data, capture_output=True, check=True, timeout=120)
        result = json.loads(out.stdout)
        if result.get('status') != 'published' or result.get('sha256') != row['sha256']:
            raise ValueError('Production publication acknowledgment differs')
        value['publication'] = result
    return value


def run(config):
    root = Path(config['run']); root.mkdir(parents=True, exist_ok=True)
    if not 1 <= config['maxWorkers'] <= 10: raise ValueError('Expected 1..10 worker limit')
    if config.get('maxChunks', 1) < 1: raise ValueError('Expected positive chunk limit')
    with (root / 'controller.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        frozen = {'binary': sha(Path(config['binary'])), 'ranking': sha(Path(config['ranking'])),
                  'policy': config['policy'], 'assets': {p.name: sha(p) for p in sorted(Path(config['assets']).iterdir()) if p.is_file()}}
        if frozen != config['frozen']: raise ValueError('Frozen build inputs differ')
        database = sqlite3.connect(root / 'queue.db')
        database.execute('PRAGMA journal_mode=WAL')
        database.execute('PRAGMA synchronous=FULL')
        database.execute('CREATE TABLE IF NOT EXISTS completed (id INTEGER PRIMARY KEY, seconds REAL, full_bytes INTEGER, shallow_bytes INTEGER, receipt TEXT NOT NULL)')
        database.execute('CREATE TABLE IF NOT EXISTS identity (value TEXT NOT NULL)')
        identity = json.dumps({'inputs': frozen, 'leads': config.get('leads', list(range(13)))}, sort_keys=True)
        prior = database.execute('SELECT value FROM identity').fetchone()
        if prior and prior[0] != identity: raise ValueError('Cannot change the plan of a resumed build')
        if not prior: database.execute('INSERT INTO identity VALUES (?)', (identity,))
        database.commit()
        completed = {r[0] for r in database.execute('SELECT id FROM completed')}
        boards = list(coordinates(Path(config['ranking'])))
        leads = config.get('leads', list(range(13)))
        if sorted(leads) != list(range(13)): raise ValueError('All lead ranks must appear exactly once')
        limit = min(len(boards)*13, config.get('maxChunks', len(boards)*13))
        if any(i < 0 or i >= limit for i in completed):
            raise ValueError('Chunk limit excludes already completed work')
        totals = list(database.execute('SELECT coalesce(sum(full_bytes),0),coalesce(sum(shallow_bytes),0) FROM completed').fetchone())
        # Count verified publication receipts once at resume, not on every update.
        published = sum(1 for (raw,) in database.execute('SELECT receipt FROM completed')
                        if (lambda v: v.get('publication', {}).get('status') == 'published'
                            and v['publication'].get('sha256') == v['production']['sha256'])(json.loads(raw)))
        prefix = 0
        while prefix in completed: prefix += 1
        def plan():
            for index in range(limit):
                if index not in completed:
                    yield index, (*boards[index // 13], leads[index % 13])
        pending = iter(plan()); jobs = {}; exhausted = False
        started = time.monotonic(); initial_count = len(completed); last_status = 0
        segment = time.time(); last_history = 0; last_state = None
        rate_points = [(started, initial_count)]
        reserve = config.get('diskReserveBytes', 20 * 1024**3)
        def progress(state, capacity, workers):
            nonlocal last_status, last_history, last_state
            now = time.monotonic()
            rate_points.append((now, len(completed)))
            # A recent five-minute rate responds to board mix and worker changes.
            while len(rate_points) > 2 and rate_points[1][0] < now - 300:
                rate_points.pop(0)
            seconds = now - rate_points[0][0]
            rate = (len(completed) - rate_points[0][1]) / seconds if seconds >= 30 else None
            value = dict(status=state, completed=len(completed), total=limit,
                contiguousCompleted=prefix, published=published, workers=workers, workerLimit=capacity,
                fullBytes=totals[0], shallowBytes=totals[1], diskFreeBytes=shutil.disk_usage(root).free,
                diskReserveBytes=reserve, chunksPerHour=rate*3600 if rate is not None else None,
                remainingHours=(limit-len(completed))/rate/3600 if rate and state == 'running' else None,
                segmentStartedAt=segment, segmentCompleted=len(completed)-initial_count,
                scheduling='background' if config.get('background', False) else 'normal',
                etaBasis='Recent five-minute throughput; extrapolation changes with board mix and contention. Archive waits are excluded.',
                updatedAt=time.time())
            atomic_json(root / 'progress.json', value)
            if now-last_history >= 30 or state != last_state:
                with (root / 'history.jsonl').open('a') as history:
                    history.write(json.dumps(value, separators=(',', ':')) + '\n')
                last_history = now
            last_state = state; last_status = now
            return value
        with concurrent.futures.ThreadPoolExecutor(max_workers=config['maxWorkers']) as pool:
            progress('running', config['maxWorkers'], 0)
            while jobs or not exhausted:
                capacity = min(available_workers(config), len(jobs) + memory_slots())
                # Drain in-flight chunks, then wait for verified foreground archiving.
                # Never discard a completed shard to make room for another.
                storage_wait = shutil.disk_usage(root).free < reserve
                while not exhausted and not storage_wait and len(jobs) < capacity:
                    item = next(pending, None)
                    if item is None: exhausted = True; break
                    index, coord = item
                    jobs[pool.submit(build, config, index, coord)] = index
                if not jobs and not exhausted: time.sleep(1)
                done, _ = concurrent.futures.wait(jobs, timeout=1, return_when=concurrent.futures.FIRST_COMPLETED)
                for job in done:
                    value = sync_chunk(config, job.result())
                    # A committed receipt means local full bytes and remote shallow
                    # bytes were both verified. Never rerun a completed calculation.
                    database.execute('INSERT INTO completed VALUES (?,?,?,?,?)',
                        (value['index'], value['elapsed'], value['full']['bytes'],
                         value['production']['bytes'], json.dumps(value, separators=(',', ':'))))
                    database.commit(); completed.add(value['index']); jobs.pop(job)
                    totals[0] += value['full']['bytes']; totals[1] += value['production']['bytes']
                    published += int(value.get('publication', {}).get('status') == 'published')
                    while prefix in completed: prefix += 1
                    shutil.rmtree(root / 'pending' / str(value['index']))
                if len(completed) == limit: exhausted = True
                if time.monotonic() - last_status > 10:
                    state = 'waiting_for_storage' if storage_wait else 'waiting_for_memory' if not capacity else 'running'
                    progress(state, capacity, len(jobs))
        database.execute('PRAGMA wal_checkpoint(TRUNCATE)'); database.close()
        archive_file(root / 'queue.db', Path(config['archive']) / config['policy'] / f'completed-queue-{len(completed)}.db', sha(root / 'queue.db'))
        final = progress('complete', 0, 0)
        atomic_json(root / 'complete.json', final)
        atomic_json(root / 'progress.json', final)


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('config', type=Path)
    args = p.parse_args(); config = json.loads(args.config.read_text())
    try: run(config)
    except BaseException as error:
        atomic_json(Path(config['run']) / 'failure.json', dict(status='failed', error=str(error), at=time.time()))
        raise


if __name__ == '__main__':
    main()
