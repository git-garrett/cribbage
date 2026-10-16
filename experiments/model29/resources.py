#!/usr/bin/env python3
"""Hold only this pilot's CPU reservation for one supervisor stage."""
import fcntl
import json
import signal
import subprocess
import sys
import time
from pathlib import Path
from learning import atomic

RESERVATION = Path('/Users/garrett/Library/Application Support/StrongCribbage/runtimes/coordination/model30-reserved-cpus.json')


def allocation(owner, workers, release=False):
    RESERVATION.parent.mkdir(parents=True,exist_ok=True)
    with RESERVATION.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        value = json.loads(RESERVATION.read_text()) if RESERVATION.exists() else dict(workers=0,allocations={})
        shares = value['allocations']
        if value['workers'] != sum(shares.values()):
            raise ValueError('inconsistent CPU reservation')
        if release:
            if shares.get(owner) != workers:
                raise ValueError('CPU reservation ownership changed')
            del shares[owner]
        else:
            if owner in shares or sum(shares.values())+workers > 11:
                raise ValueError('CPU reservation unavailable')
            shares[owner] = workers
        value.update(workers=sum(shares.values()),updatedAt=time.time())
        atomic(RESERVATION,value)


def run(owner, workers, command):
    child = None; claimed = False
    def stop(*_):
        raise InterruptedError('Model 29 stage stopped')
    signal.signal(signal.SIGTERM,stop); signal.signal(signal.SIGINT,stop)
    try:
        blocked = signal.pthread_sigmask(signal.SIG_BLOCK,{signal.SIGTERM,signal.SIGINT})
        try:
            allocation(owner,workers); claimed = True
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK,blocked)
        child = subprocess.Popen(command)
        code = child.wait()
        if code:
            raise subprocess.CalledProcessError(code,command)
    finally:
        signal.signal(signal.SIGTERM,signal.SIG_IGN); signal.signal(signal.SIGINT,signal.SIG_IGN)
        if child and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill(); child.wait()
        if claimed:
            allocation(owner,workers,release=True)


if __name__ == '__main__':
    run(sys.argv[1],int(sys.argv[2]),sys.argv[3:])
