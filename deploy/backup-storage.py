#!/usr/bin/env python3
"""Download a source Storage manifest without modifying the source project.

Usage: python3 backup-storage.py /opt/rhi/backups/source-TIMESTAMP
Files use object IDs on disk. Receipts preserve bucket/key, version, size and SHA256.
Reruns reuse verified files; errors are explicit and prevent a success exit.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import threading
import time
from urllib.parse import quote

import requests

assert socket.gethostname().split('.')[0] == 'srv2126686', 'Wrong destination host'
os.umask(0o077)
backup = Path(sys.argv[1]).resolve()
assert backup.parent == Path('/opt/rhi/backups')
config = json.loads(Path('/opt/rhi/migration/source-transfer.json').read_text())
assert config['url'] == 'https://dhnxwrteolnjdrxlmgwi.supabase.co'
objects = json.loads((backup / 'storage-objects.json').read_text())
target = backup / 'storage-files'
target.mkdir(mode=0o700, exist_ok=True)
state = threading.local()


def normalized_etag(value):
    return str(value or '').removeprefix('W/').strip('"')


def copy_object(obj):
    object_id = obj['id']
    assert len(object_id) == 36 and all(c in '0123456789abcdef-' for c in object_id)
    blob = target / object_id
    receipt_path = target / (object_id + '.json')
    version = obj.get('version')
    metadata = obj.get('metadata') or {}
    expected_etag = normalized_etag(metadata.get('eTag'))
    if blob.exists() and receipt_path.exists():
        previous = json.loads(receipt_path.read_text())
        if (previous['source_version'] == version
                and normalized_etag(previous.get('etag')) == expected_etag
                and blob.stat().st_size == int(metadata['size'])):
            with blob.open('rb') as existing:
                digest = hashlib.file_digest(existing, 'sha256').hexdigest()
            if digest == previous['sha256']:
                return previous
    if not hasattr(state, 'session'):
        state.session = requests.Session()
        state.session.headers.update({'apikey': config['serviceRoleKey'],
            'Authorization': 'Bearer ' + config['serviceRoleKey']})
    url = (config['url'] + '/storage/v1/object/authenticated/' +
           quote(obj['bucket_id'], safe='') + '/' + quote(obj['name'], safe='/'))
    last_status = None
    for attempt in range(4):
        partial = target / (object_id + '.partial')
        try:
            with state.session.get(url, stream=True, timeout=(15, 90)) as response:
                last_status = response.status_code
                response.raise_for_status()
                if expected_etag and normalized_etag(response.headers.get('ETag')) != expected_etag:
                    raise ValueError('ETag changed since database snapshot')
                digest = hashlib.sha256()
                size = 0
                with partial.open('wb') as stream:
                    for chunk in response.iter_content(1024 * 1024):
                        stream.write(chunk)
                        digest.update(chunk)
                        size += len(chunk)
                expected = metadata.get('size')
                if expected is not None and size != int(expected):
                    raise ValueError('Size changed since database snapshot')
                receipt = {'id': object_id, 'bucket': obj['bucket_id'], 'name': obj['name'],
                           'source_version': version, 'bytes': size, 'sha256': digest.hexdigest(),
                           'etag': response.headers.get('ETag'),
                           'content_type': response.headers.get('Content-Type')}
                partial.replace(blob)
                receipt_path.write_text(json.dumps(receipt))
                return receipt
        except (requests.RequestException, ValueError):
            partial.unlink(missing_ok=True)
            time.sleep(2 ** attempt)
    # Object paths can contain personal data; report IDs only in operational output.
    return {'id': object_id, 'error': 'download_failed_or_source_changed', 'http_status': last_status}


results = []
workers = max(1, min(8, int(os.environ.get('RHI_STORAGE_WORKERS', '4'))))
with ThreadPoolExecutor(max_workers=workers) as pool:
    tasks = [pool.submit(copy_object, obj) for obj in objects]
    for task in as_completed(tasks):
        results.append(task.result())
        if len(results) % 250 == 0:
            summary = {'processed': len(results), 'total': len(objects),
                       'errors': sum('error' in r for r in results),
                       'bytes': sum(r.get('bytes', 0) for r in results)}
            (backup / 'storage-progress.json').write_text(json.dumps(summary))
            print(json.dumps(summary), flush=True)

(backup / 'storage-verification.json').write_text(json.dumps(results, indent=2))
failures = sum('error' in r for r in results)
print(json.dumps({'completed': len(results), 'errors': failures}), flush=True)
sys.exit(1 if failures else 0)
