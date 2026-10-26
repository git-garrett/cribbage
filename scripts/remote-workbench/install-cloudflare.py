#!/usr/bin/env python3
"""Install the Mac's outbound Cloudflare connector; leave the SSH fallback intact."""
import argparse
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile

LABEL = 'com.strongcribbage.workbench-cloudflare'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary', type=Path, help='Persistent, verified cloudflared binary (2025.4.0+)')
    parser.add_argument('token_file', type=Path, help='Private file containing the tunnel token')
    args = parser.parse_args()
    binary = args.binary.expanduser().resolve()
    source = args.token_file.expanduser().resolve()
    if not binary.is_file() or not os.access(binary, os.X_OK):
        parser.error('cloudflared must be an executable file')
    if not source.is_file() or source.stat().st_mode & 0o077:
        parser.error('The token file must exist and have owner-only permissions')
    token = source.read_text().strip()
    if not token or any(c.isspace() for c in token):
        parser.error('Expected one nonempty tunnel token')
    subprocess.run([str(binary), '--version'], check=True)
    os.umask(0o077)
    root = Path.home() / '.config/strongcribbage-workbench'
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    root.chmod(0o700)
    destination = root / 'cloudflare-token'
    # Atomic replacement prevents a reconnect from reading an incomplete token.
    with tempfile.NamedTemporaryFile(mode='w', dir=root, delete=False) as staged:
        staged.write(token + '\n')
    os.replace(staged.name, destination)
    arguments = [str(binary), 'tunnel', '--no-autoupdate', '--loglevel', 'warn',
                 '--metrics', '127.0.0.1:0', 'run', '--token-file', str(destination)]
    target = f'gui/{os.getuid()}'
    plist = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
    plist.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['/bin/launchctl', 'bootout', target + '/' + LABEL],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    plist.write_bytes(plistlib.dumps({
        'Label': LABEL, 'ProgramArguments': arguments, 'RunAtLoad': True,
        'KeepAlive': True, 'ThrottleInterval': 15,
        'StandardOutPath': str(root / 'cloudflare.log'),
        'StandardErrorPath': str(root / 'cloudflare.log'),
    }))
    plist.chmod(0o600)
    subprocess.run(['/bin/launchctl', 'bootstrap', target, str(plist)], check=True)
    print(f'Connector installed: {LABEL}; live source must remain awake and online.')


if __name__ == '__main__':
    main()
