#!/usr/bin/env python3
"""Bounded, supervised archive worker for one frozen opening-asset build."""
import argparse
import fcntl
import json
from pathlib import Path
import shutil
import sqlite3
import time

from archive_model283_opening_assets import ArchiveBusy, archive
from cribbage_job_queue import atomic_json


def watch(config, destination, state_path, interval=60, batch_chunks=4096, max_age=1800,
          headroom=4 * 1024**3, mount=None):
    if interval <= 0 or batch_chunks <= 0 or max_age <= 0 or headroom < 0:
        raise ValueError('Invalid archive cadence')
    run = Path(config['run'])
    target = config['maxChunks']
    if target <= 0: raise ValueError('Expected a finite positive target')
    location = destination.resolve() / config['policy']
    with (run / 'archive-worker.lock').open('a') as worker_lock:
        fcntl.flock(worker_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        while True:
            if mount is not None and not mount.is_mount():
                raise RuntimeError('Archive volume is not mounted; resume explicitly after reconnecting it')
            with sqlite3.connect((run / 'queue.db').as_uri() + '?mode=ro', uri=True) as db:
                count, low, high = db.execute('SELECT count(*),min(id),max(id) FROM completed').fetchone()
            if count > target or (count and (low < 0 or high >= target)):
                raise ValueError('Queue exceeds the frozen archive target')
            path = run / 'archive-progress.json'
            prior = json.loads(path.read_text()) if path.exists() else {}
            if prior and (prior.get('status') != 'complete' or prior.get('policy') != config['policy']
                          or Path(prior['location']).resolve() != location):
                raise ValueError('Archive checkpoint does not match this worker')
            archived = prior.get('completed', 0)
            if archived > count: raise ValueError('Live queue lost archived receipts')
            pending = count - archived
            free = shutil.disk_usage(run).free
            due = pending and (pending >= batch_chunks or count == target
                or time.time() - prior.get('updatedAt', 0) >= max_age
                or free < config.get('diskReserveBytes', 20 * 1024**3) + headroom)
            state = dict(status='waiting', completed=count, archived=archived, pending=pending,
                         target=target, freeBytes=free, updatedAt=time.time())
            if due or (count == target and archived == target):
                state['status'] = 'archiving'
                atomic_json(state_path, state)
                try:
                    result = archive(config, destination, release=True, incremental=True, mount=mount)
                except ArchiveBusy:
                    # A foreground archive owns the shared lock. Waiting is
                    # normal coordination, not retrying a failed copy.
                    state['status'] = 'waiting_for_archive_lock'
                else:
                    state.update(status='waiting', archived=result['completed'],
                                 releasedBytes=result['releasedBytes'])
                    if count == target and result['completed'] == target:
                        state.update(status='complete', checkpoint=result['checkpoint'],
                                     queueSha256=result['queueSha256'], completed=target,
                                     archived=target, pending=0)
                        atomic_json(state_path, state)
                        return state
            atomic_json(state_path, state)
            time.sleep(interval)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('config', type=Path)
    p.add_argument('destination', type=Path)
    p.add_argument('state', type=Path)
    p.add_argument('--mount', type=Path)
    p.add_argument('--interval', type=float, default=60)
    p.add_argument('--batch-chunks', type=int, default=4096)
    p.add_argument('--max-age', type=float, default=1800)
    args = p.parse_args()
    try:
        watch(json.loads(args.config.read_text()), args.destination, args.state,
              args.interval, args.batch_chunks, args.max_age, mount=args.mount)
    except Exception as error:
        atomic_json(args.state, dict(status='failed', error=str(error), updatedAt=time.time()))
        raise


if __name__ == '__main__': main()
