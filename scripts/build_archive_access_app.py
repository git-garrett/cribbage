#!/usr/bin/env python3
"""Build the local folder-permission helper; does not grant access or launch jobs."""
import argparse
from pathlib import Path
import plistlib
import subprocess
import tempfile


def build(output):
    if output.exists():
        raise ValueError('Choose a new output path; replacing a signed helper can invalidate its grant')
    contents = output / 'Contents'
    executable = contents / 'MacOS' / 'ArchiveAccess'
    executable.parent.mkdir(parents=True)
    info = dict(CFBundleIdentifier='com.strongcribbage.archive', CFBundleName='Cribbage Archive',
                CFBundleDisplayName='Cribbage Archive', CFBundleExecutable='ArchiveAccess',
                CFBundlePackageType='APPL', CFBundleVersion='1', LSUIElement=True,
                NSRemovableVolumesUsageDescription='Save verified cribbage assets in your chosen archive folder.')
    (contents / 'Info.plist').write_bytes(plistlib.dumps(info))
    with tempfile.TemporaryDirectory(prefix='cribbage-archive-build-') as d:
        temporary = Path(d)
        entitlements = temporary / 'entitlements.plist'
        entitlements.write_bytes(plistlib.dumps({
            'com.apple.security.files.bookmarks.app-scope': True,
            'com.apple.security.files.user-selected.read-write': True}))
        subprocess.run(['/usr/bin/xcrun', 'swiftc', '-O', '-module-cache-path', str(temporary/'modules'),
                        str(Path(__file__).parent/'macos/AssetArchiveAccess.swift'),
                        '-o', str(executable)], check=True)
        subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', '--entitlements', str(entitlements),
                        str(output)], check=True)
    subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(output)], check=True)
    print(output)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('output', type=Path)
    build(p.parse_args().output)
