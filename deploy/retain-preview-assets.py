#!/usr/bin/env python3
"""Keep immutable public assets available to tabs which defer a PWA update."""
import hashlib
import json
from pathlib import Path
import shutil
import socket
import sys


def retain(release, destination):
    manifest = json.loads((release / 'release.json').read_text())
    files = []
    for name, digest in manifest['files'].items():
        if not name.startswith('assets/'):
            continue
        source = release / name
        target = destination / name
        assert source.resolve().is_relative_to(release.resolve()) and source.is_file() and not source.is_symlink()
        assert target.resolve().is_relative_to(destination.resolve()) and not target.is_symlink()
        assert hashlib.sha256(source.read_bytes()).hexdigest() == digest, 'Release asset checksum mismatch'
        if target.exists():
            assert hashlib.sha256(target.read_bytes()).hexdigest() == digest, 'Immutable asset name collision'
        files.append((source, target, digest))
    # Validate all names/checksums before copying. Only files from the public
    # release manifest are eligible; configuration/data backups are never read.
    for source, target, digest in files:
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        assert hashlib.sha256(target.read_bytes()).hexdigest() == digest
    return len(files)


if __name__ == '__main__':
    assert socket.gethostname().split('.')[0] == 'srv2126686'
    release = Path(sys.argv[1]).resolve()
    assert release.parent == Path('/var/www/rhi/releases')
    print('Retained public assets:', retain(release, Path('/var/www/rhi/retained')))
