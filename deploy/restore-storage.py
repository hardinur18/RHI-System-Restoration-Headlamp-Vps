#!/usr/bin/env python3
"""Restore verified blobs to the tested local Storage backend, preserving versions.

Run only with Storage/functions stopped. Database object rows are restored
separately. This never contacts the source or changes its objects.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys

assert socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
backup = Path(sys.argv[1]).resolve()
assert backup.parent == Path('/opt/rhi/backups')
running = subprocess.check_output(['docker', 'ps', '--format', '{{.Names}}'], text=True).splitlines()
assert 'supabase-storage' not in running and 'supabase-edge-functions' not in running
root = Path('/opt/rhi/supabase/volumes/storage').resolve()
fixture = json.loads(Path('/opt/rhi/migration/storage-layout-fixture.json').read_text())
assert fixture['path'].startswith(str(root / 'stub/stub/rhi-migration-fixture') + '/')
objects = json.loads((backup / 'storage-objects.json').read_text())
receipts = {r['id']: r for r in json.loads((backup / 'storage-verification.json').read_text())}
assert len(receipts) == len(objects) and not any('error' in r for r in receipts.values())

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

results = []
for obj in objects:
    receipt = receipts[obj['id']]
    assert receipt['source_version'] == obj['version']
    source = backup / 'storage-files' / obj['id']
    assert source.is_file() and digest(source) == receipt['sha256']
    # The fixture confirms tenant/bucket prefixes and slash version separator.
    parts = [obj['bucket_id'], obj['name']]
    if obj.get('version'):
        parts.append(obj['version'])
    for part in parts:
        assert not part.startswith('/') and all(p not in ('', '.', '..') for p in part.split('/'))
    target = root.joinpath('stub', 'stub', *parts).resolve()
    assert target.is_relative_to(root / 'stub/stub')
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        assert digest(target) == receipt['sha256'], 'Refuse to overwrite different target data'
    else:
        temporary = target.with_name(target.name + '.migration-partial')
        shutil.copyfile(source, temporary)
        assert digest(temporary) == receipt['sha256']
        temporary.replace(target)
    metadata = obj.get('metadata') or {}
    for name, value in {
        'content-type': metadata.get('mimetype') or receipt.get('content_type') or 'application/octet-stream',
        'cache-control': metadata.get('cacheControl') or 'no-cache',
        'content-encoding': metadata.get('contentEncoding'),
    }.items():
        if value:
            os.setxattr(target, 'user.supabase.' + name, value.encode())
    modified = metadata.get('lastModified') or obj['updated_at']
    timestamp = datetime.datetime.fromisoformat(modified.replace('Z', '+00:00')).timestamp()
    os.utime(target, (timestamp, timestamp))
    results.append({'id': obj['id'], 'sha256': receipt['sha256'], 'bytes': target.stat().st_size})
    if len(results) % 1000 == 0:
        print(json.dumps({'restored': len(results), 'total': len(objects)}), flush=True)
(backup / 'storage-restore-verification.json').write_text(json.dumps(results, indent=2))
print(json.dumps({'restored': len(results), 'bytes': sum(r['bytes'] for r in results)}), flush=True)
