#!/usr/bin/env python3
"""Install the Mac's reconnecting, outbound-only workbench SSH tunnel."""
import argparse
import ipaddress
import os
from pathlib import Path
import plistlib
import shutil
import subprocess

LABEL = 'com.strongcribbage.workbench-tunnel'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('server', type=ipaddress.IPv4Address)
    parser.add_argument('key', type=Path, help='Dedicated tunnel private key')
    parser.add_argument('known_hosts', type=Path, help='Previously verified server host key')
    args = parser.parse_args()
    os.umask(0o077)
    server = str(args.server)
    for source in (args.key, args.known_hosts):
        if not source.is_file():
            parser.error(f'Missing file: {source}')
    subprocess.run(['/usr/bin/ssh-keygen', '-F', server, '-f', str(args.known_hosts)],
                   check=True, stdout=subprocess.DEVNULL)
    root = Path.home() / '.config/strongcribbage-workbench'
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    root.chmod(0o700)
    for source, name in ((args.key, 'tunnel_ed25519'), (args.known_hosts, 'known_hosts')):
        destination = root / name
        if source.resolve() != destination.resolve():
            shutil.copyfile(source, destination)
        destination.chmod(0o600)
    arguments = ['/usr/bin/ssh', '-F', '/dev/null', '-NT', '-i', str(root / 'tunnel_ed25519'),
        '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
        '-o', f'UserKnownHostsFile={root / "known_hosts"}', '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-o', 'ConnectTimeout=15',
        '-R', '127.0.0.1:18766:127.0.0.1:8766', f'workbench-tunnel@{server}']
    target = f'gui/{os.getuid()}'
    plist = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
    plist.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['/bin/launchctl', 'bootout', target + '/' + LABEL],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    plist.write_bytes(plistlib.dumps({'Label': LABEL, 'ProgramArguments': arguments,
        'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 15,
        'StandardErrorPath': str(root / 'tunnel.log')}))
    subprocess.run(['/bin/launchctl', 'bootstrap', target, str(plist)], check=True)
    print(f'Tunnel installed: {LABEL}; live source must remain awake and online.')


if __name__ == '__main__':
    main()
