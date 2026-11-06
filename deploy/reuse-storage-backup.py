#!/usr/bin/env python3
"""Reuse immutable, unchanged snapshot files before backup-storage.py verification.

Only matching object IDs, paths, versions and sizes are linked. The subsequent
backup script still hashes every reused file and downloads any missing version.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('previous')
parser.add_argument('current')
args = parser.parse_args()
assert socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
previous, current = Path(args.previous).resolve(), Path(args.current).resolve()
assert previous != current
assert previous.parent == current.parent == Path('/opt/rhi/backups')
objects = json.loads((current / 'storage-objects.json').read_text())
destination = current / 'storage-files'
destination.mkdir(mode=0o700, exist_ok=True)
reused = 0
for obj in objects:
    object_id = str(uuid.UUID(obj['id']))
    blob, receipt = previous / 'storage-files' / object_id, previous / 'storage-files' / (object_id + '.json')
    if not blob.is_file() or blob.is_symlink() or not receipt.is_file():
        continue
    old = json.loads(receipt.read_text())
    metadata = obj.get('metadata') or {}
    normalize_etag = lambda value: str(value or '').removeprefix('W/').strip('"')
    if any([old.get('id') != object_id, old.get('source_version') != obj.get('version'),
            old.get('bucket') != obj['bucket_id'], old.get('name') != obj['name'],
            normalize_etag(old.get('etag')) != normalize_etag(metadata.get('eTag')),
            old.get('bytes') != metadata.get('size'), blob.stat().st_size != old.get('bytes')]):
        continue
    target = destination / object_id
    if not target.exists():
        os.link(blob, target)
        shutil.copyfile(receipt, destination / receipt.name)
        reused += 1
print(json.dumps({'reused_immutable_files': reused, 'total_objects': len(objects),
                  'next_step': 'backup-storage.py must verify all checksums'}))
