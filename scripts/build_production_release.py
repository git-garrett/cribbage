#!/usr/bin/env python3
"""Build and verify the native Linux API without touching the live service."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import sys

from build_rust_release import build, digest, publish, save


def verify(root, commit):
    record = json.loads((root / 'pgo-build.json').read_text())
    if (record.get('status') != 'complete' or record.get('gitCommit') != commit
            or record.get('flags') != [] or record.get('models') != ['ace']
            or record.get('apiTestsPassed') is not True
            or not record.get('profileSha256')):
        raise ValueError('Production PGO receipt does not match the requested release')
    for suite in ['train', 'validate']:
        result = record.get('results', {}).get('ace/' + suite, {})
        if result.get('bitExact') is not True or result.get('cases', 0) < 1:
            raise ValueError('Production PGO parity verification is missing')
    binary = root / 'rust/target/release/cribbage-api'
    if digest(binary) != record.get('binaries', {}).get('cribbage-api'):
        raise ValueError('Production API binary does not match its PGO receipt')
    return record


def build_release(root, target_dir, commit):
    if sys.platform != 'linux':
        raise ValueError('Production releases must be built natively on Linux')
    target_dir.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(target_dir).free < 700 * 1024 * 1024:
        raise ValueError('Production PGO build needs at least 700 MiB free after unpacking')
    # The measured production configuration has no native CPU or caller flags.
    os.environ.pop('RUSTFLAGS', None)
    os.environ.pop('CARGO_ENCODED_RUSTFLAGS', None)
    os.environ['CRIBBAGE_BUILD_GIT_COMMIT'] = commit
    os.environ['CARGO_BUILD_JOBS'] = '1'
    build(argparse.Namespace(kind='api', root=root, model_root=None, corpus=None,
                             target_dir=target_dir, target=None, model=['ace'],
                             offline=False, no_pgo=False, pgo=True, compact=True,
                             api_tests=True))
    record = json.loads((target_dir / 'pgo/api/latest.json').read_text())
    publish({'cribbage-api': target_dir / 'release/cribbage-api'},
            root / 'rust/target/release')
    (root / 'rust/target/release/cribbage-api').chmod(0o755)
    save(root / 'pgo-build.json', record)
    verify(root, commit)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('target_dir', type=Path)
    parser.add_argument('commit')
    parser.add_argument('--verify-only', action='store_true')
    options = parser.parse_args()
    root = options.root.resolve()
    if not re.fullmatch('[0-9a-f]{40}', options.commit):
        raise ValueError('Expected a full Git commit')
    if json.loads((root / 'deployment.json').read_text()).get('gitCommit') != options.commit:
        raise ValueError('Deployment manifest does not match the requested commit')
    if options.verify_only:
        verify(root, options.commit)
    else:
        build_release(root, options.target_dir.resolve(), options.commit)
    print('Production PGO binary and receipt verified: ' + options.commit)


if __name__ == '__main__':
    main()
