#!/usr/bin/env python3
"""Replay the verified 6 November delta on a private throwaway database only."""
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess

assert os.geteuid() == 0 and socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
root = Path('/opt/rhi/migration')
spec = importlib.util.spec_from_file_location('delta', root / 'plan-delta.py')
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)
plan = Path('/opt/rhi/backups/delta-20261106T123332Z')
manifest = json.loads((plan / 'manifest.json').read_text())
archive = plan / 'target-before-delta.dump'
with archive.open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == (plan / 'rollback-sha256.txt').read_text().strip()
database = 'rhi_delta_rehearsal_' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
report_root = root / 'rehearsals' / database
report_root.mkdir(mode=0o700, parents=True)
with delta.connection_target(admin=True) as db, db.cursor() as cur:
    cur.execute('show cron.launch_active_jobs')
    assert cur.fetchone()[0] == 'off'
    cur.execute('select count(*) from cron.job where active')
    assert cur.fetchone()[0] == 0
    cur.execute('select 1 from pg_database where datname=%s', (database,))
    assert cur.fetchone() is None
db.close()
base = ['docker', 'exec', 'supabase-db']
subprocess.run(base + ['createdb', '-U', 'supabase_admin', '-T', 'template0', database], check=True)
(report_root / 'created.json').write_text(json.dumps({'database': database, 'plan': str(plan), 'purpose': 'disposable-delta-rehearsal'}))
with delta.connection_target(admin=True, database=database) as db, db.cursor() as cur:
    cur.execute('CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions; '
        'CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions; CREATE SCHEMA auth; CREATE SCHEMA storage; '
        'CREATE SCHEMA supabase_migrations; CREATE SCHEMA rhi_migration; CREATE PUBLICATION supabase_realtime; '
        'REVOKE CONNECT ON DATABASE ' + database + ' FROM PUBLIC;')
db.close()
with archive.open('rb') as stream, (report_root / 'restore.log').open('w') as log:
    subprocess.run(['docker', 'exec', '-i', 'supabase-db', 'pg_restore', '-U', 'supabase_admin',
        '-d', database, '--single-transaction', '--exit-on-error',
        '-n', 'auth', '-n', 'storage', '-n', 'public', '-n', 'supabase_migrations', '-n', 'rhi_migration'],
        stdin=stream, stdout=log, stderr=log, check=True)
print('Restored historical target into private rehearsal database', flush=True)
subprocess.run(['python3', str(root / 'apply-delta.py'), str(plan), '--rollback-rehearsal',
                '--isolated-rehearsal-database', database], check=True)
with delta.connection_target(admin=True, database=database) as db:
    for entry in manifest['tables']:
        rows = delta.hashes(db, entry['schema'], entry['table'], entry['keys'])
        assert delta.digest(rows) == entry['target_digest'], 'Rollback failed to restore baseline'
db.close()
# Only this run's newly created database can be removed. Failure evidence survives.
with delta.connection_target(admin=True) as db, db.cursor() as cur:
    cur.execute('select count(*) from pg_stat_activity where datname=%s', (database,))
    assert cur.fetchone()[0] == 0
db.close()
subprocess.run(base + ['dropdb', '-U', 'supabase_admin', database], check=True)
report = {'completed_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'plan': plan.name, 'database': database, 'passed': True,
          'verified_tables': len(manifest['tables']), 'rollback_baseline_verified': True,
          'rehearsal_database_removed': True, 'source_changed': False, 'public_preview_changed': False,
          'scope': 'Historical delta replay, Storage bytes read-only, no provider callback switch or final data sync'}
(report_root / 'result.json').write_text(json.dumps(report, indent=2))
(root / 'latest-cutover-rehearsal.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report), flush=True)
