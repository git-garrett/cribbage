#!/usr/bin/env python3
"""Hold only this pilot's CPU reservation for one supervisor stage."""
import fcntl
import json
import hashlib
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from learning import atomic

RESERVATION = Path('/Users/garrett/Library/Application Support/StrongCribbage/runtimes/coordination/model30-reserved-cpus.json')


def allocation(owner, workers, release=False, reclaim=False):
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
            if owner in shares and (not reclaim or shares[owner] != workers):
                raise ValueError('CPU reservation ownership changed')
            if sum(shares.values())-shares.get(owner,0)+workers > 11:
                raise ValueError('CPU reservation unavailable')
            shares[owner] = workers
        value.update(workers=sum(shares.values()),updatedAt=time.time())
        atomic(RESERVATION,value)


def run(owner, workers, command):
    if not 1 <= workers <= 11:
        raise ValueError('invalid CPU allocation')
    RESERVATION.parent.mkdir(parents=True,exist_ok=True)
    lease_path = RESERVATION.parent/('model29-lease-'+hashlib.sha256(owner.encode()).hexdigest()+'.lock')
    lease = lease_path.open('a')
    # Unlike a recorded PID, this kernel lease survives PID reuse safely. Pass
    # it to every worker so an orphaned live worker also blocks a second writer.
    # The kernel releases it after SIGKILL/reboot once all holders have exited.
    fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
    child = None; claimed = False
    def stop(*_):
        raise InterruptedError('Model 29 stage stopped')
    signal.signal(signal.SIGTERM,stop); signal.signal(signal.SIGINT,stop)
    try:
        blocked = signal.pthread_sigmask(signal.SIG_BLOCK,{signal.SIGTERM,signal.SIGINT})
        try:
            allocation(owner,workers,reclaim=True); claimed = True
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK,blocked)
        env = dict(os.environ,MODEL29_LEASE_FD=str(lease.fileno()))
        child = subprocess.Popen(command,env=env,pass_fds=(lease.fileno(),),start_new_session=True)
        code = child.wait()
        if code:
            raise subprocess.CalledProcessError(code,command)
    finally:
        signal.signal(signal.SIGTERM,signal.SIG_IGN); signal.signal(signal.SIGINT,signal.SIG_IGN)
        if child:
            terminate_group(child)
        if claimed:
            allocation(owner,workers,release=True)
        lease.close()


def terminate_group(child):
    # The direct child may have crashed while native grandchildren still run.
    # Its process group remains ours until every descendant has exited.
    try:
        os.killpg(child.pid,signal.SIGTERM)
        deadline = time.monotonic()+2
        while time.monotonic() < deadline:
            try:
                os.killpg(child.pid,0)
            except ProcessLookupError:
                break
            time.sleep(.05)
        else:
            os.killpg(child.pid,signal.SIGKILL)
    except ProcessLookupError:
        pass
    child.wait(timeout=10)


if __name__ == '__main__':
    run(sys.argv[1],int(sys.argv[2]),sys.argv[3:])
