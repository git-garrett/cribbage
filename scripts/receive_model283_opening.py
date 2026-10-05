#!/usr/bin/env python3
"""Receive one verified shallow opening shard on the dedicated asset mount."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import sys
import tempfile

MAX_BYTES = 16 * 1024 * 1024
RELATIVE = re.compile(r'cut(\d+)/pone(\d+)/dealer(\d+)-lead(\d+)\.bin')


def inspect_shard(data, policy, relative, depth=2):
    if not re.fullmatch(r'[a-f0-9]{64}', policy):
        raise ValueError('Invalid policy fingerprint')
    match = RELATIVE.fullmatch(relative)
    if not match or len(data) < 4 or len(data) > MAX_BYTES:
        raise ValueError('Invalid shard path or length')
    cut, pone, dealer, lead = map(int, match.groups())
    if cut >= 13 or lead >= 13 or pone >= 121 or dealer >= 121:
        raise ValueError('Invalid coordinates')
    size = struct.unpack('<I', data[:4])[0]
    if size > 8192 or 4 + size > len(data):
        raise ValueError('Invalid header length')
    h = json.loads(data[4:4 + size])
    expected = dict(format=4, policy=policy, cut=cut, scores=[pone, dealer],
                    lead=lead, dealerPlays=depth)
    if any(h.get(k) != v for k, v in expected.items()):
        raise ValueError('Shard context or depth differs')
    if h.get('sha256') != hashlib.sha256(data[4 + size:]).hexdigest():
        raise ValueError('Shard body digest differs')
    if not isinstance(h.get('rows'), int) or not 0 <= h['rows'] <= 4_000_000:
        raise ValueError('Invalid row count')
    return h


def receive(root, policy, relative, expected_sha, data):
    if not root.is_dir() or not os.path.ismount(root):
        raise ValueError('Dedicated asset volume is not mounted; refusing root-disk writes')
    inspect_shard(data, policy, relative)
    digest = hashlib.sha256(data).hexdigest()
    if digest != expected_sha:
        raise ValueError('Transport digest differs')
    version = root / 'openings' / policy
    target = version / relative
    if target.is_file():
        if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise ValueError('Immutable shard already exists with different bytes')
    else:
        if shutil.disk_usage(root).free < len(data) + 1024**3:
            raise ValueError('Less than 1 GiB asset-volume headroom remains')
        target.parent.mkdir(parents=True, exist_ok=True)
        descriptor, name = tempfile.mkstemp(prefix='.upload-', dir=target.parent)
        temporary = Path(name)
        try:
            with os.fdopen(descriptor, 'wb') as out:
                out.write(data)
                out.flush()
                os.fchmod(out.fileno(), 0o644)
                os.fsync(out.fileno())
            os.replace(temporary, target)
            descriptor = os.open(target.parent, os.O_RDONLY)
            try: os.fsync(descriptor)
            finally: os.close(descriptor)
        finally:
            temporary.unlink(missing_ok=True)
    return dict(status='published', sha256=digest, bytes=len(data), path=str(target), policy=policy)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('policy'); p.add_argument('relative'); p.add_argument('sha256')
    args = p.parse_args()
    result = receive(Path('/var/lib/cribbage-assets'), args.policy, args.relative,
                     args.sha256, sys.stdin.buffer.read(MAX_BYTES + 1))
    print(json.dumps(result))


if __name__ == '__main__':
    main()
