#!/usr/bin/env python3
"""Restore the application/Auth/Storage archive into an isolated comparison DB.

Source internal schemas are retained here for verification, never overlaid onto
the running self-hosted service schemas. No scheduler/HTTP queue is imported.
"""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys

assert socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
backup = Path(sys.argv[1]).resolve()
assert backup.parent == Path('/opt/rhi/backups')
with (backup / 'database.dump').open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == json.loads(
        (backup / 'archive-verification.json').read_text())['sha256']
database = 'rhi_source_snapshot'
base = ['docker', 'exec', 'supabase-db']
exists = subprocess.check_output(base + ['psql', '-U', 'supabase_admin', '-d', 'postgres', '-Atc',
    "select count(*) from pg_database where datname='rhi_source_snapshot'"], text=True).strip()
assert exists == '0', 'Reference database already exists; never overwrite a verified snapshot'
subprocess.run(base + ['createdb', '-U', 'supabase_admin', '-T', 'template0', database], check=True)
subprocess.run(base + ['psql', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-c',
    'CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions; '
    'CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions; CREATE SCHEMA auth; CREATE SCHEMA storage; '
    'CREATE SCHEMA supabase_migrations; CREATE PUBLICATION supabase_realtime; '
    'REVOKE CONNECT ON DATABASE rhi_source_snapshot FROM PUBLIC;'], check=True)
subprocess.run(['docker', 'cp', str(backup / 'database.dump'), 'supabase-db:/tmp/rhi-source.dump'], check=True)
with Path('/opt/rhi/migration/restore-reference.log').open('w') as log:
    result = subprocess.run(base + ['pg_restore', '-U', 'supabase_admin', '-d', database,
        '--single-transaction', '--exit-on-error', '--no-owner', '-n', 'auth', '-n', 'storage',
        '-n', 'public', '-n', 'supabase_migrations', '/tmp/rhi-source.dump'], stdout=log, stderr=log)
assert result.returncode == 0, 'Reference restore rolled back; inspect private log'
print('Reference restore completed')
