#!/usr/bin/env python3
"""Foreground, verified archival of committed chunks; optional staging release.

The builder never writes this destination. A consistent queue snapshot is copied
with the full and two-reply shards before any internal shard can be released.
The separate archive lock permits concurrent building, not concurrent archivers.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import time

from build_model283_opening_assets import archive_file, sha, sync_directory
from cribbage_job_queue import atomic_json


class ArchiveBusy(BlockingIOError):
    pass


def check_mount(mount, target):
    if mount is None: return
    if not mount.is_mount() or not target.is_relative_to(mount.resolve()):
        raise RuntimeError('Archive volume is not mounted at the expected location')
    existing = target
    while not existing.exists(): existing = existing.parent
    if existing.stat().st_dev != mount.stat().st_dev:
        raise RuntimeError('Archive location is on the wrong volume')


def previous_checkpoint(run, target, config, db):
    """Reuse only an exact, durably saved checkpoint of this immutable archive."""
    path = run / 'archive-progress.json'
    if not path.exists(): return None
    value = json.loads(path.read_text())
    if (value.get('status') != 'complete' or value.get('policy') != config['policy']
            or Path(value['location']).resolve() != target):
        raise ValueError('Previous archive identity differs')
    local = Path(value['localCheckpoint'])
    remote = Path(value['checkpoint'])
    if not remote.resolve().is_relative_to(target):
        raise ValueError('Previous checkpoint is outside the archive')
    for checkpoint in (local, remote):
        if sha(checkpoint) != value['queueSha256']:
            raise ValueError('Previous archive checkpoint digest differs')
    receipt = json.loads(remote.with_name('receipt.json').read_text())
    for key in ('status', 'policy', 'completed', 'bytes', 'queueSha256', 'location'):
        if receipt.get(key) != value.get(key):
            raise ValueError('Previous durable archive receipt differs')
    db.execute('ATTACH DATABASE ? AS previous', (local.as_uri() + '?mode=ro&immutable=1',))
    identity = json.loads(db.execute('SELECT value FROM previous.identity').fetchone()[0])
    if identity['inputs'] != config['frozen']:
        raise ValueError('Previous archive frozen inputs differ')
    if db.execute('SELECT count(*) FROM previous.completed').fetchone()[0] != value['completed']:
        raise ValueError('Previous archive count differs')
    if db.execute('''SELECT 1 FROM previous.completed p LEFT JOIN completed c ON c.id=p.id
                     WHERE c.id IS NULL OR c.receipt != p.receipt LIMIT 1''').fetchone():
        raise ValueError('Previously archived receipt changed or disappeared')
    return value


def archive(config, destination, release=False, incremental=False, mount=None):
    run = Path(config['run'])
    source = Path(config['archive']) / config['policy']
    target = destination.resolve() / config['policy']
    check_mount(mount, target)
    if source.resolve() == target or source.resolve() in target.parents or target in source.resolve().parents:
        raise ValueError('Archive destination must be separate from staging')
    with (run / 'archive.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ArchiveBusy('Another archive owns the shared lock') from error
        stamp = str(time.time_ns())
        record = run / 'archive-snapshots' / stamp
        record.mkdir(parents=True)
        snapshot = record / 'queue.db'
        with sqlite3.connect((run / 'queue.db').as_uri() + '?mode=ro', uri=True) as live:
            with sqlite3.connect(snapshot) as copy: live.backup(copy)
        with snapshot.open('rb') as handle: os.fsync(handle.fileno())
        for directory in (record, record.parent, run): sync_directory(directory)
        with sqlite3.connect(snapshot.as_uri() + '?mode=ro&immutable=1', uri=True) as db:
            if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise ValueError('Queue snapshot integrity failed')
            identity = json.loads(db.execute('SELECT value FROM identity').fetchone()[0])
            if identity['inputs'] != config['frozen']:
                raise ValueError('Archive policy/input identity mismatch')
            prior = previous_checkpoint(run, target, config, db) if incremental else None
            count = 0; total = 0; directories = set()
            query = ('SELECT c.id,c.receipt,p.id IS NOT NULL FROM completed c '
                     'LEFT JOIN previous.completed p ON p.id=c.id ORDER BY c.id') if prior else (
                     'SELECT id,receipt,0 FROM completed ORDER BY id')
            last_progress = 0
            for index, raw, reused in db.execute(query):
                v = json.loads(raw)
                relative = Path(v['relative'])
                if relative.is_absolute() or '..' in relative.parts or v['index'] != index:
                    raise ValueError('Invalid committed chunk path/index')
                if config.get('remote') and (v.get('publication', {}).get('status') != 'published'
                        or v['publication'].get('sha256') != v['production']['sha256']):
                    raise ValueError('Missing verified publication receipt')
                for kind in ('full', 'production'):
                    row = v[kind]; src = source / kind / relative; dst = target / kind / relative
                    if row['policy'] != config['policy']: raise ValueError('Shard policy mismatch')
                    # Existing destination must still match. Missing staging is
                    # acceptable only when a previous verified archive has it.
                    if not reused:
                        check_mount(mount, target)
                        archive_file(src, dst, row['sha256'])
                        if dst.stat().st_size != row['bytes'] or sha(dst) != row['sha256']:
                            raise ValueError('Final archive bytes differ')
                        directories.update(dst.parents)
                    total += row['bytes']
                count += 1
                if time.monotonic() - last_progress >= 10:
                    atomic_json(run / 'archive-transfer-progress.json', dict(
                        status='copying', completed=count, snapshot=str(snapshot), updatedAt=time.time()))
                    last_progress = time.monotonic()
            checkpoint = target / 'foreground-snapshots' / stamp / 'queue.db'
            check_mount(mount, target)
            digest = sha(snapshot)
            archive_file(snapshot, checkpoint, digest)
            result = dict(status='complete', policy=config['policy'], completed=count,
                          bytes=total, updatedAt=time.time(), location=str(target),
                          checkpoint=str(checkpoint), localCheckpoint=str(snapshot),
                          queueSha256=digest, releasedBytes=0,
                          reusedChunks=prior['completed'] if prior else 0, releaseComplete=False)
            # Evidence is durable before releasing any staging bytes. A crash
            # while releasing merely leaves additional staging copies behind.
            receipt = record / 'receipt.json'
            atomic_json(receipt, result)
            sync_directory(record)
            archive_file(receipt, checkpoint.with_name('receipt.json'), sha(receipt))
            directories.update(checkpoint.parents)
            # Also cover directories retained from an earlier interrupted copy.
            # Only ~3,200 distinct directories are needed for the full domain.
            for directory in sorted(directories, key=lambda p: len(p.parts), reverse=True):
                sync_directory(directory)
            check_mount(mount, target)
            atomic_json(run / 'archive-progress.json', result)
            sync_directory(run)
            if release:
                atomic_json(run / 'archive-transfer-progress.json', dict(
                    status='releasing', completed=count, snapshot=str(snapshot), updatedAt=time.time()))
                for index, raw, reused in db.execute(query):
                    v = json.loads(raw)
                    for kind in ('full', 'production'):
                        src = source / kind / v['relative']
                        if src.exists():
                            check_mount(mount, target)
                            # A previous pass may have published its checkpoint
                            # before crashing during cleanup. Recheck the actual
                            # durable copy before releasing any such survivor.
                            if reused and sha(target / kind / v['relative']) != v[kind]['sha256']:
                                raise ValueError('Retained archive shard changed')
                            if sha(src) != v[kind]['sha256']:
                                raise ValueError('Staging changed after archive verification')
                            src.unlink(); result['releasedBytes'] += v[kind]['bytes']
                result['releaseComplete'] = True
                atomic_json(run / 'archive-progress.json', result)
                sync_directory(run)
            atomic_json(run / 'archive-transfer-progress.json', dict(
                status='complete', completed=count, snapshot=str(snapshot), updatedAt=time.time()))
            if prior:
                old_local = Path(prior['localCheckpoint'])
                if old_local.resolve().is_relative_to((run / 'archive-snapshots').resolve()):
                    # The durable checkpoint remains on the archive volume.
                    # Keeping every growing SQLite snapshot internally would
                    # eventually consume the space this process is releasing.
                    old_local.unlink(missing_ok=True)
        return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('config', type=Path); p.add_argument('destination', type=Path)
    p.add_argument('--release-staging', action='store_true', help='Remove only committed, verified archived shard copies from internal staging')
    p.add_argument('--incremental', action='store_true', help='Reuse the previous verified immutable archive checkpoint; omit to audit all shards')
    p.add_argument('--mount', type=Path, help='Require the archive to stay on this mounted volume')
    args = p.parse_args()
    result = archive(json.loads(args.config.read_text()), args.destination, args.release_staging, args.incremental, args.mount)
    print(json.dumps({key: result[key] for key in ('status', 'completed', 'bytes', 'releasedBytes', 'location')}))


if __name__ == '__main__': main()
