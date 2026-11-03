#!/usr/bin/env python3
"""Copy an audited inherited cache into persistent local storage; no new solves."""
import concurrent.futures
import hashlib
import json
import shutil
import sqlite3
import sys
import time
from pathlib import Path
from learning import atomic


def run(root):
    root=Path(root); config=json.loads((root/'config.json').read_text())
    if hashlib.sha256((root/'manifest.jsonl').read_bytes()).hexdigest()!=config['manifestSha256']:
        raise ValueError('staging manifest changed')
    db=sqlite3.connect(root/'copies.db')
    db.execute('create table if not exists completed(id integer primary key, sha256 text not null)')
    done={r[0] for r in db.execute('select id from completed')}
    rows=[json.loads(line) for line in (root/'manifest.jsonl').read_text().splitlines()]
    def copy(row):
        relative=Path(row['relative'])
        if relative.is_absolute() or '..' in relative.parts:raise ValueError('invalid cache path')
        target=root/'chunks'/relative; source=Path(config['source'])/relative
        target.parent.mkdir(parents=True,exist_ok=True)
        data=source.read_bytes()
        if hashlib.sha256(data).hexdigest()!=row['sha256']:raise ValueError('inherited cache checksum differs')
        temp=target.with_suffix('.tmp');temp.write_bytes(data);temp.replace(target)
        if hashlib.sha256(target.read_bytes()).hexdigest()!=row['sha256']:raise ValueError('staged cache checksum differs')
        return row
    start=time.monotonic();pending=[row for row in rows if row['id'] not in done]
    with concurrent.futures.ThreadPoolExecutor(max_workers=config['workers']) as pool:
        # Executor.map on all million rows would retain hundreds of thousands
        # of futures. Keep a bounded batch and checkpoint each completion.
        for offset in range(0,len(pending),256):
            for row in pool.map(copy,pending[offset:offset+256]):
                db.execute('insert into completed values(?,?)',(row['id'],row['sha256']))
                done.add(row['id'])
            db.commit()
            atomic(root/'progress.json',dict(status='copying',chunks=len(done),target=len(rows),seconds=time.monotonic()-start,updatedAt=time.time()))
    if len(done)!=len(rows) or done!=set(range(len(rows))):raise ValueError('incomplete cache staging')
    atomic(root/'receipt.json',dict(status='complete',chunks=len(done),manifestSha256=config['manifestSha256'],bytes=sum(r['bytes'] for r in rows),source=config['source']))


if __name__=='__main__':run(sys.argv[1])
