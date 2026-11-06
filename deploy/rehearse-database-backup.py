#!/usr/bin/env python3
"""Restore a verified local backup into a NEW, private rehearsal database.

Compare every row in application/Auth/Storage schemas to the quiet staging
database. No source DB is contacted. Never overwrites or drops a database.
This tests logical data recovery, not a complete new-host disaster recovery.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import subprocess

spec = importlib.util.spec_from_file_location('delta', Path(__file__).with_name('plan-delta.py'))
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup')
    parser.add_argument('database', help='New database named rhi_backup_rehearsal_<digits>')
    args = parser.parse_args()
    assert socket.gethostname().split('.')[0] == 'srv2126686'
    assert os.geteuid() == 0
    os.umask(0o077)
    backup = Path(args.backup).resolve()
    assert backup.parent == Path('/opt/rhi/backups/daily-database')
    assert re.fullmatch(r'\d{8}T\d{6}Z', backup.name)
    assert re.fullmatch(r'rhi_backup_rehearsal_\d+', args.database)
    subprocess.run(['sha256sum', '-c', 'SHA256SUMS'], cwd=backup, check=True)
    base = ['docker', 'exec', 'supabase-db']
    conn = delta.connection_target(admin=True)
    with conn, conn.cursor() as cur:
        cur.execute('SELECT 1 FROM pg_database WHERE datname=%s', (args.database,))
        assert cur.fetchone() is None, 'Never overwrite an existing rehearsal database'
        cur.execute('SHOW cron.launch_active_jobs')
        assert cur.fetchone()[0] == 'off', 'Staging isolation is required'
        cur.execute('SELECT count(*) FROM cron.job WHERE active')
        assert cur.fetchone()[0] == 0
    conn.close()
    subprocess.run(base + ['createdb', '-U', 'supabase_admin', '-T', 'template0', args.database], check=True)
    subprocess.run(base + ['psql', '-U', 'supabase_admin', '-d', args.database, '-v', 'ON_ERROR_STOP=1', '-c',
        'CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions; '
        'CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions; CREATE SCHEMA auth; CREATE SCHEMA storage; '
        'CREATE SCHEMA supabase_migrations; CREATE PUBLICATION supabase_realtime; '
        'REVOKE CONNECT ON DATABASE ' + args.database + ' FROM PUBLIC;'], check=True)
    # Stream the archive: no second copy of private data in container /tmp.
    log_path = backup / (args.database + '.log')
    with (backup / 'postgres.dump').open('rb') as archive, log_path.open('w') as log:
        subprocess.run(['docker', 'exec', '-i', 'supabase-db', 'pg_restore', '-U', 'supabase_admin',
            '-d', args.database, '--single-transaction', '--exit-on-error', '--no-owner',
            '-n', 'auth', '-n', 'storage', '-n', 'public', '-n', 'supabase_migrations'],
            stdin=archive, stdout=log, stderr=log, check=True)
    current = delta.connection_target(admin=True)
    restored = delta.connection_target(admin=True, database=args.database)
    results = []
    try:
        for database in (current, restored):
            database.set_session(isolation_level='REPEATABLE READ', readonly=True)
            with database.cursor() as cur:
                cur.execute("SET LOCAL search_path=public; SET LOCAL timezone='UTC'; SET LOCAL statement_timeout='180s'")
        query = """SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN
            ('public','auth','storage','supabase_migrations') ORDER BY 1,2"""
        with current.cursor() as cur:
            cur.execute(query)
            tables = cur.fetchall()
        with restored.cursor() as cur:
            cur.execute(query)
            assert tables == cur.fetchall(), 'Table inventory differs'
        for index, (schema, table) in enumerate(tables):
            columns, keys = delta.metadata(current, schema, table)
            assert (columns, keys) == delta.metadata(restored, schema, table), 'Column/PK metadata differs'
            a = delta.hashes(current, schema, table, keys)
            b = delta.hashes(restored, schema, table, keys)
            results.append({'schema': schema, 'table': table, 'current_rows': len(a),
                            'restored_rows': len(b), 'matched': delta.digest(a) == delta.digest(b)})
            if index % 20 == 0:
                print('Verified tables:', index + 1, flush=True)
    finally:
        current.close()
        restored.close()
    with (backup / 'postgres.dump').open('rb') as stream:
        checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
    report = {'database': args.database, 'archive_sha256': checksum,
              'all_matched': all(row['matched'] for row in results), 'tables': results,
              'scope': 'Application/Auth/Storage logical data; comparison requires a quiet target'}
    (backup / (args.database + '.json')).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'tables': len(results), 'all_matched': report['all_matched']}), flush=True)
    assert report['all_matched'], 'Backup/target drift: inspect report; do not label it verified'


if __name__ == '__main__':
    main()
