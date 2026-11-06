#!/usr/bin/env python3
"""Check private UAT isolation and full cloned row/file integrity before writes."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import requests

assert socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
root = Path('/opt/rhi/uat-20261106')
spec = importlib.util.spec_from_file_location('delta', '/opt/rhi/migration/plan-delta.py')
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)
report = {'isolation': [], 'tables': [], 'storage': {}}
def inspect(kind, name):
    return json.loads(subprocess.check_output(['docker', kind, 'inspect', name]))[0]
network = inspect('network', 'rhi_uat_isolated')
assert network['Internal']
for suffix in ('auth', 'rest', 'storage', 'functions', 'mail', 'gateway'):
    c = inspect('container', 'rhi-uat-' + suffix)
    assert c['State']['Running'], suffix + ' is not running'
    assert set(c['NetworkSettings']['Networks']) == {'rhi_uat_isolated'}
    for bindings in c['HostConfig']['PortBindings'].values():
        assert all(b['HostIp'] == '127.0.0.1' for b in bindings)
    env = dict(v.split('=', 1) for v in c['Config']['Env'])
    for key, value in env.items():
        if key in ('GOTRUE_DB_DATABASE_URL', 'PGRST_DB_URI', 'DATABASE_URL', 'SUPABASE_DB_URL'):
            assert '@rhi-uat-db:5432/rhi_uat_20261106' in value
    report['isolation'].append(suffix + ': internal network, loopback ports, UAT database')
keys = json.loads((root / 'keys.json').read_text())
preview_env = dict(line.split('=', 1) for line in Path('/opt/rhi/supabase/.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
assert keys['JWT_SECRET'] != preview_env['JWT_SECRET']
for path in ('/auth/v1/health', '/rest/v1/'):
    r = requests.get('http://127.0.0.1:18080' + path, headers={'apikey': keys['ANON_KEY'], 'Authorization': 'Bearer ' + keys['ANON_KEY']}, timeout=15)
    assert r.ok, (path, r.status_code)
current, restored = delta.connection_target(admin=True), delta.connection_target(admin=True, database='rhi_uat_20261106')
try:
    for db in (current, restored):
        db.set_session(isolation_level='REPEATABLE READ', readonly=True)
        with db.cursor() as cur:
            cur.execute("SET LOCAL search_path=public; SET LOCAL timezone='UTC'; SET LOCAL statement_timeout='180s'")
    with current.cursor() as cur:
        cur.execute("SELECT count(*) FROM pg_trigger WHERE tgname='rhi_preview_readonly' AND tgenabled='A'")
        assert cur.fetchone()[0] > 70, 'Preview fence must remain enabled'
        cur.execute("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','auth','storage','supabase_migrations') ORDER BY 1,2")
        tables = cur.fetchall()
    with restored.cursor() as cur:
        cur.execute("SELECT count(*) FROM pg_trigger WHERE tgname='rhi_preview_readonly'")
        assert cur.fetchone()[0] == 0
    for schema, table in tables:
        columns, pk = delta.metadata(current, schema, table)
        assert (columns, pk) == delta.metadata(restored, schema, table)
        a, b = delta.hashes(current, schema, table, pk), delta.hashes(restored, schema, table, pk)
        report['tables'].append({'schema': schema, 'table': table, 'rows': len(b), 'matched': delta.digest(a) == delta.digest(b)})
    print('Compared database tables:', len(tables), flush=True)
finally:
    current.close()
    restored.close()
source, target = Path('/opt/rhi/supabase/volumes/storage'), root / 'storage'
files, size = 0, 0
for original in source.rglob('*'):
    if not original.is_file():
        continue
    relative = original.relative_to(source)
    copy = target / relative
    assert copy.is_file() and original.stat().st_size == copy.stat().st_size, 'Storage copy inventory differs'
    assert (original.stat().st_dev, original.stat().st_ino) != (copy.stat().st_dev, copy.stat().st_ino), 'Writable storage must not share inodes'
    with original.open('rb') as a, copy.open('rb') as b:
        assert hashlib.file_digest(a, 'sha256').digest() == hashlib.file_digest(b, 'sha256').digest(), 'Storage checksum differs'
    files += 1
    size += original.stat().st_size
assert files == sum(p.is_file() for p in target.rglob('*'))
report['storage'] = {'files': files, 'bytes': size, 'all_sha256_matched': True, 'independent_inodes': True}
report['all_tables_matched'] = all(t['matched'] for t in report['tables'])
(root / 'baseline-verification.json').write_text(json.dumps(report, indent=2))
print(json.dumps({'tables': len(report['tables']), 'all_tables_matched': report['all_tables_matched'], 'storage': report['storage']}), flush=True)
assert report['all_tables_matched'], 'Inspect table drift before UAT writes'
