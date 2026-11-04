#!/usr/bin/env python3
"""Read every restored object through HTTPS Storage and compare its full SHA256."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import socket
import threading
from urllib.parse import quote
import requests

assert socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
backup = Path('/opt/rhi/backups/source-20261104T082954Z')
env = dict(line.split('=', 1) for line in Path('/opt/rhi/supabase/.env').read_text().splitlines()
           if '=' in line and not line.startswith('#'))
resolve = socket.getaddrinfo
socket.getaddrinfo = lambda host, *args, **kwargs: resolve(
    '127.0.0.1' if host == 'api-rhi.polesheadlamp.id' else host, *args, **kwargs)
receipts = json.loads((backup / 'storage-verification.json').read_text())
state = threading.local()

def verify(receipt):
    if not hasattr(state, 'session'):
        state.session = requests.Session()
        state.session.headers.update({'apikey': env['SERVICE_ROLE_KEY'],
                                       'Authorization': 'Bearer ' + env['SERVICE_ROLE_KEY']})
    url = 'https://api-rhi.polesheadlamp.id/storage/v1/object/authenticated/' + \
        quote(receipt['bucket'], safe='') + '/' + quote(receipt['name'], safe='/')
    try:
        with state.session.get(url, stream=True, timeout=(10, 60)) as response:
            checksum = hashlib.sha256()
            size = 0
            for chunk in response.iter_content(1024 * 1024):
                checksum.update(chunk)
                size += len(chunk)
            valid = response.status_code == 200 and checksum.hexdigest() == receipt['sha256'] and size == receipt['bytes']
            return {'id': receipt['id'], 'http_status': response.status_code, 'bytes': size,
                    'sha256': checksum.hexdigest(), 'matched': valid}
    except requests.RequestException:
        return {'id': receipt['id'], 'matched': False, 'error': 'request_failed'}

results = []
with ThreadPoolExecutor(max_workers=6) as pool:
    futures = [pool.submit(verify, receipt) for receipt in receipts]
    for future in as_completed(futures):
        results.append(future.result())
        if len(results) % 1000 == 0:
            print(json.dumps({'checked': len(results), 'failed': sum(not x['matched'] for x in results)}), flush=True)
(backup / 'storage-api-verification.json').write_text(json.dumps(results, indent=2))
failed = sum(not x['matched'] for x in results)
print(json.dumps({'objects': len(results), 'failed': failed, 'bytes': sum(x.get('bytes', 0) for x in results)}), flush=True)
assert failed == 0
