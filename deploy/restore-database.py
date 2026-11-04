#!/usr/bin/env python3
"""One-time restore into the verified, empty RHI staging database.

Keep target Auth/Storage service schemas and migration ledgers. Restore all
application definitions/data, Auth data, Storage metadata/policies, migrations
and Realtime publication membership. Never import cron jobs or HTTP queues.
The unmodified archive and reference database retain every source object.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys

assert socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
backup = Path(sys.argv[1]).resolve()
assert backup.parent == Path('/opt/rhi/backups')
work = Path('/opt/rhi/migration')
archive = backup / 'database.dump'
with archive.open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == json.loads(
        (backup / 'archive-verification.json').read_text())['sha256']
running = subprocess.check_output(['docker', 'ps', '--format', '{{.Names}}'], text=True).splitlines()
assert not set(running) & {'supabase-edge-functions', 'supabase-auth', 'supabase-storage',
                           'supabase-rest', 'realtime-dev.supabase-realtime'}

def query(statement, database='postgres'):
    return subprocess.check_output(['docker', 'exec', 'supabase-db', 'psql', '-U', 'postgres',
        '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement], text=True).strip()

assert query("select count(*) from pg_tables where schemaname='public'") == '0'
assert query('select count(*) from auth.users') == '0'
assert query('select count(*) from storage.objects') == '0'
counts = json.loads((backup / 'row-counts.json').read_text())
assert query('select count(*) from public.orders', 'rhi_source_snapshot') == str(
    next(t['rows'] for t in counts if t['schema'] == 'public' and t['table'] == 'orders'))

subprocess.run(['docker', 'exec', 'supabase-db', 'pg_dump', '-U', 'postgres', '-Fc',
    '-f', '/tmp/rhi-before-restore.dump', 'postgres'], check=True)
subprocess.run(['docker', 'cp', 'supabase-db:/tmp/rhi-before-restore.dump',
    str(work / 'target-before-restore.dump')], check=True)

target_tables = set(query("select schemaname||'.'||tablename from pg_tables").splitlines())
excluded = []
selected = []
for line in (work / 'archive-toc.txt').read_text().splitlines():
    match = re.match(r'^\d+; \d+ \d+ (.*?) (public|auth|storage|supabase_migrations) (.*)$', line)
    if not match:
        continue
    kind, schema, detail = match.groups()
    include = schema in ('public', 'supabase_migrations')
    if schema in ('auth', 'storage') and kind in ('TABLE DATA', 'SEQUENCE SET'):
        table = detail.split()[0]
        if table in ('schema_migrations', 'migrations'):
            excluded.append({'schema': schema, 'table': table, 'reason': 'retain target service migration ledger'})
        elif kind == 'TABLE DATA' and schema + '.' + table not in target_tables:
            entry = next(t for t in counts if t['schema'] == schema and t['table'] == table)
            assert entry['rows'] == 0, 'Missing nonempty source table requires explicit compatibility work'
            excluded.append({**entry, 'reason': 'empty cloud service internal table; preserved in reference/archive'})
        else:
            include = True
    if schema == 'storage' and kind == 'POLICY':
        include = True
    if include:
        selected.append(line)
assert sum('TABLE DATA public ' in x for x in selected) == sum(t['schema'] == 'public' for t in counts)
(work / 'restore-selected.list').write_text('\n'.join(selected) + '\n')
(work / 'restore-exclusions.json').write_text(json.dumps(excluded, indent=2))
subprocess.run(['docker', 'cp', str(work / 'restore-selected.list'), 'supabase-db:/tmp/rhi-selected.list'], check=True)
subprocess.run(['docker', 'exec', 'supabase-db', 'pg_restore',
    '--use-list=/tmp/rhi-selected.list', '-f', '/tmp/rhi-selected.sql', '/tmp/rhi-source.dump'], check=True)
with (work / 'restore-target.log').open('w') as log:
    # Fresh self-hosted templates grant broad default privileges. Remove those
    # before creating objects; the archive then applies the source ACLs/defaults.
    defaults = ''.join(
        f'ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA public REVOKE ALL ON {kind} FROM anon,authenticated,service_role;'
        for owner in ('postgres', 'supabase_admin')
        for kind in ('TABLES', 'FUNCTIONS', 'SEQUENCES'))
    result = subprocess.run(['docker', 'exec', 'supabase-db', 'psql', '-U', 'supabase_admin', '-d', 'postgres',
        '-v', 'ON_ERROR_STOP=1', '--single-transaction',
        '-c', 'SET session_replication_role=replica; TRUNCATE storage.buckets CASCADE;' + defaults,
        '-f', '/tmp/rhi-selected.sql'], stdout=log, stderr=log)
assert result.returncode == 0, 'Restore rolled back; inspect private restore-target.log'
print(json.dumps({'restored_archive_entries': len(selected), 'documented_exclusions': len(excluded)}))
