#!/usr/bin/env python3
"""Foreground, verified archival of committed chunks; optional staging release.

The builder never writes this destination. A consistent queue snapshot is copied
with the full and two-reply shards before any internal shard can be released.
The separate archive lock permits concurrent building, not concurrent archivers.
"""
import argparse
import fcntl
import json
from pathlib import Path
import sqlite3
import time

from build_model283_opening_assets import archive_file, sha
from cribbage_job_queue import atomic_json


def archive(config, destination, release=False):
    run = Path(config['run'])
    source = Path(config['archive']) / config['policy']
    target = destination.resolve() / config['policy']
    if source.resolve() == target or source.resolve() in target.parents or target in source.resolve().parents:
        raise ValueError('Archive destination must be separate from staging')
    with (run / 'archive.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        stamp = str(time.time_ns())
        record = run / 'archive-snapshots' / stamp
        record.mkdir(parents=True)
        snapshot = record / 'queue.db'
        with sqlite3.connect((run / 'queue.db').as_uri() + '?mode=ro', uri=True) as live:
            with sqlite3.connect(snapshot) as copy: live.backup(copy)
        with sqlite3.connect(snapshot.as_uri() + '?mode=ro&immutable=1', uri=True) as db:
            if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise ValueError('Queue snapshot integrity failed')
            identity = json.loads(db.execute('SELECT value FROM identity').fetchone()[0])
            if identity['inputs'] != config['frozen']:
                raise ValueError('Archive policy/input identity mismatch')
            count = 0; total = 0
            for index, raw in db.execute('SELECT id,receipt FROM completed ORDER BY id'):
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
                    archive_file(src, dst, row['sha256'])
                    if dst.stat().st_size != row['bytes'] or sha(dst) != row['sha256']:
                        raise ValueError('Final archive bytes differ')
                    total += row['bytes']
                count += 1
            checkpoint = target / 'foreground-snapshots' / stamp / 'queue.db'
            digest = sha(snapshot)
            archive_file(snapshot, checkpoint, digest)
            result = dict(status='complete', policy=config['policy'], completed=count,
                          bytes=total, updatedAt=time.time(), location=str(target),
                          checkpoint=str(checkpoint), localCheckpoint=str(snapshot),
                          queueSha256=digest, releasedBytes=0)
            # Evidence is durable before releasing any staging bytes. A crash
            # while releasing merely leaves additional staging copies behind.
            receipt = record / 'receipt.json'
            atomic_json(receipt, result)
            archive_file(receipt, checkpoint.with_name('receipt.json'), sha(receipt))
            atomic_json(run / 'archive-progress.json', result)
            if release:
                for (raw,) in db.execute('SELECT receipt FROM completed ORDER BY id'):
                    v = json.loads(raw)
                    for kind in ('full', 'production'):
                        src = source / kind / v['relative']
                        if src.exists():
                            if sha(src) != v[kind]['sha256']:
                                raise ValueError('Staging changed after archive verification')
                            src.unlink(); result['releasedBytes'] += v[kind]['bytes']
                atomic_json(run / 'archive-progress.json', result)
        return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('config', type=Path); p.add_argument('destination', type=Path)
    p.add_argument('--release-staging', action='store_true', help='Remove only committed, verified archived shard copies from internal staging')
    args = p.parse_args()
    result = archive(json.loads(args.config.read_text()), args.destination, args.release_staging)
    print(json.dumps({key: result[key] for key in ('status', 'completed', 'bytes', 'releasedBytes', 'location')}))


if __name__ == '__main__': main()
