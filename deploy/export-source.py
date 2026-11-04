#!/usr/bin/env python3
"""Read-only source snapshot, inventory and full logical archive on the RHI VPS.

Requires python3-psycopg2. Secrets live in /opt/rhi/migration/source.pgpass.
The archive is a backup, NOT a script to blindly restore over Supabase internals.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess

import psycopg2
from psycopg2 import sql

assert socket.gethostname().split('.')[0] == 'srv2126686', 'Wrong destination host'
os.umask(0o077)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = Path('/opt/rhi/backups') / ('source-' + stamp)
backup.mkdir(mode=0o700)
dsn = ('host=aws-1-ap-south-1.pooler.supabase.com port=5432 dbname=postgres '
       'user=postgres.dhnxwrteolnjdrxlmgwi sslmode=require connect_timeout=15')
os.environ['PGPASSFILE'] = '/opt/rhi/migration/source.pgpass'


def save(name, data):
    (backup / name).write_text(json.dumps(data, indent=2, default=str) + '\n')


with psycopg2.connect(dsn) as conn:
    conn.set_session(isolation_level='REPEATABLE READ', readonly=True)
    with conn.cursor() as cur:
        cur.execute("set local statement_timeout = '120s'")
        cur.execute("set local lock_timeout = '5s'")
        cur.execute("select current_setting('transaction_read_only'), pg_export_snapshot()")
        readonly, snapshot = cur.fetchone()
        assert readonly == 'on'
        save('snapshot.json', {'started_utc': stamp, 'source_ref': 'dhnxwrteolnjdrxlmgwi',
                              'snapshot': snapshot, 'read_only': True})
        cur.execute("""select schemaname, tablename from pg_tables
            where schemaname in ('public','auth','storage','supabase_migrations')
            order by schemaname, tablename""")
        tables = cur.fetchall()
        counts = []
        for schema, table in tables:
            cur.execute(sql.SQL('select count(*) from {}.{}').format(
                sql.Identifier(schema), sql.Identifier(table)))
            counts.append({'schema': schema, 'table': table, 'rows': cur.fetchone()[0]})
        save('row-counts.json', counts)
        for name, query in {
            'storage-buckets.json': 'select row_to_json(b) from storage.buckets b order by id',
            'storage-objects.json': 'select row_to_json(o) from storage.objects o order by bucket_id, name',
            'cron-jobs.json': 'select row_to_json(j) from cron.job j order by jobid',
            'extensions.json': 'select row_to_json(e) from pg_extension e order by extname',
        }.items():
            cur.execute(query)
            save(name, [r[0] for r in cur.fetchall()])
        print('Consistent read-only snapshot recorded; starting full archive', flush=True)
        image = 'postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b'
        with (backup / 'pg-dump.log').open('w') as log:
            subprocess.run([
                'docker', 'run', '--rm', '--network', 'host',
                '-v', '/opt/rhi/migration:/migration:ro', '-v', str(backup) + ':/backup',
                '-e', 'PGPASSFILE=/migration/source.pgpass', image,
                'pg_dump', '--dbname=' + dsn, '--format=custom', '--compress=6',
                '--lock-wait-timeout=5000', '--snapshot=' + snapshot,
                '--file=/backup/database.dump',
            ], check=True, stdout=log, stderr=log)

digest = hashlib.sha256()
(backup / 'database.dump').chmod(0o600)
with (backup / 'database.dump').open('rb') as archive:
    for chunk in iter(lambda: archive.read(4 * 1024 * 1024), b''):
        digest.update(chunk)
save('archive-verification.json', {'sha256': digest.hexdigest(),
    'bytes': (backup / 'database.dump').stat().st_size,
    'completed_utc': datetime.datetime.now(datetime.timezone.utc).isoformat()})
print('Source database archive complete:', backup, flush=True)
