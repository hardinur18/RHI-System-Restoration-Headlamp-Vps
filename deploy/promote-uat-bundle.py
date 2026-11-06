#!/usr/bin/env python3
"""Promote the tested lead-attribution fix to read-only RHI; never cut over."""
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import requests
import psycopg2

assert socket.gethostname().split('.')[0] == 'srv2126686' and os.geteuid() == 0
os.umask(0o077)
root = Path('/opt/rhi/uat-20261106')
load = lambda name: json.loads((root / name).read_text())
receipt = load('make-server-f781cd00-candidate.receipt.json')
assert receipt['official_parser_verified'] and receipt['all_module_bytes_and_maps_verified']
assert load('baseline-verification.json')['all_tables_matched']
assert load('workflow-verification.json')['passed'] and load('workflow-verification.json')['fixtures_cleaned']
assert load('business-write-verification.json')['passed'] and load('business-write-verification.json')['fixture_cleaned']
assert all(row['passed'] for row in load('business-read-verification.json')['checks'])
assert not load('mail-and-reset-verification.json')['fixture_cleanup_failures']
assert len(load('mail-and-reset-verification.json')['checks']) == 3
assert load('browser-verification.json')['passed']
assert not list(root.glob('*fixture.json')) and not list(root.glob('*fixtures.json'))
spec = importlib.util.spec_from_file_location('delta', '/opt/rhi/migration/plan-delta.py')
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)
with delta.connection_target(admin=True) as db, db.cursor() as cur:
    cur.execute("SELECT count(*) FROM pg_trigger WHERE tgname='rhi_preview_readonly' AND tgenabled='A'")
    assert cur.fetchone()[0] > 70
    cur.execute('SHOW cron.launch_active_jobs')
    assert cur.fetchone()[0] == 'off'
container = json.loads(subprocess.check_output(['docker', 'inspect', 'supabase-edge-functions']))[0]
for network in container['NetworkSettings']['Networks']:
    assert json.loads(subprocess.check_output(['docker', 'network', 'inspect', network]))[0]['Internal']
folder = Path('/opt/rhi/supabase/volumes/functions/bundles')
bundle, manifest = folder / 'make-server-f781cd00.eszip', folder / 'manifest.json'
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert digest(bundle) == receipt['original_sha256'], 'Preview release changed; review first'
candidate = root / 'make-server-f781cd00-candidate.eszip'
assert digest(candidate) == receipt['patched_sha256']
rows = json.loads(manifest.read_text())
record = next(row for row in rows if row['slug'] == 'make-server-f781cd00')
assert record['sha256'] == receipt['original_sha256']
record['sha256'] = receipt['patched_sha256']
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = Path('/opt/rhi/migration') / ('preview-bundle-before-' + stamp)
backup.mkdir(mode=0o700)
shutil.copy2(bundle, backup / bundle.name)
shutil.copy2(manifest, backup / manifest.name)
resolve = socket.getaddrinfo
socket.getaddrinfo = lambda host, *a, **kw: resolve('127.0.0.1' if host == 'api-rhi.polesheadlamp.id' else host, *a, **kw)
env = dict(line.split('=',1) for line in Path('/opt/rhi/supabase/.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
headers = {'apikey': env['ANON_KEY'], 'Authorization': 'Bearer ' + env['ANON_KEY']}
base = 'https://api-rhi.polesheadlamp.id'
try:
    subprocess.run(['docker','stop','supabase-edge-functions'],check=True,stdout=subprocess.DEVNULL)
    shutil.copyfile(candidate, bundle.with_suffix('.pending'))
    bundle.with_suffix('.pending').replace(bundle)
    manifest.with_suffix('.pending').write_text(json.dumps(rows, indent=2))
    manifest.with_suffix('.pending').replace(manifest)
    subprocess.run(['docker','start','supabase-edge-functions'],check=True,stdout=subprocess.DEVNULL)
    ready = False
    for _ in range(10):
        try:
            response = requests.get(base + '/functions/v1/make-server-f781cd00/app-data/orders',headers=headers,timeout=10)
            ready = response.status_code == 401
        except requests.RequestException:
            pass
        if ready: break
        time.sleep(2)
    assert ready, 'Worker did not become ready'
    # Loopback bypasses the external Nginx fence by design. Verify the database
    # fence with the actual application login role, using a zero-row statement.
    db_info = json.loads(subprocess.check_output(['docker','inspect','supabase-db']))[0]
    db_ip = next(iter(db_info['NetworkSettings']['Networks'].values()))['IPAddress']
    connection = psycopg2.connect(host=db_ip, user='authenticator', password=env['POSTGRES_PASSWORD'], dbname='postgres', connect_timeout=10)
    try:
        with connection.cursor() as cur:
            cur.execute('SET ROLE authenticated')
            try:
                cur.execute('DELETE FROM public.orders WHERE false')
            except psycopg2.Error as error:
                assert error.pgcode == '25006', 'Unexpected fence response'
            else:
                raise AssertionError('Preview database fence is missing')
    finally:
        connection.rollback()
        connection.close()

except BaseException:
    shutil.copy2(backup / bundle.name,bundle)
    shutil.copy2(backup / manifest.name,manifest)
    subprocess.run(['docker','restart','supabase-edge-functions'],check=True,stdout=subprocess.DEVNULL)
    raise
report = {'completed_utc': stamp, 'bundle_sha256': digest(bundle), 'rollback_directory': str(backup),
          'preview_read_only_verified': True, 'source_changed': False, 'cutover': False}
(root / 'preview-promotion.json').write_text(json.dumps(report,indent=2))
print('Tested fix active on read-only RHI; source and cutover unchanged',flush=True)
