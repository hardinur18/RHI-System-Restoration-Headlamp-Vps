#!/usr/bin/env python3
"""Refresh the isolated local-preview dataset from VPS production, never Cloud.

prepare: read a consistent production snapshot into a NEW private database and
independent Storage directory; compare every copied table and file before use.
activate RUN: swap only the existing UAT database/Storage, preserving both old
copies. No production containers, credentials, schedulers or data are changed.
Run on the dedicated VPS. Output contains counts/hashes only, not row contents.
"""
import argparse
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
from psycopg2 import sql

ROOT = Path('/opt/rhi/uat-20261106')
ACTIVE = 'rhi_uat_20261106'
NETWORK = 'rhi_uat_isolated'
EGRESS_NETWORK = 'supabase_function_egress'
SERVICES = ['rhi-uat-' + x for x in ('functions', 'storage', 'rest', 'auth', 'realtime')]
SCHEMAS = ('public', 'auth', 'storage', 'supabase_migrations', 'rhi_migration', 'extensions')


def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]


def isolation():
    network = json.loads(subprocess.check_output(['docker', 'network', 'inspect', NETWORK]))[0]
    assert network['Internal'], 'UAT network must remain internal'
    for name in SERVICES:
        c = inspect(name)
        expected_networks = {NETWORK, EGRESS_NETWORK} if name == 'rhi-uat-functions' else {NETWORK}
        assert set(c['NetworkSettings']['Networks']) == expected_networks, name
        assert c['Config']['Labels'].get('rhi.purpose') == 'disposable-uat', name
        env = dict(v.split('=', 1) for v in c['Config']['Env'])
        for key in ('GOTRUE_DB_DATABASE_URL', 'PGRST_DB_URI', 'DATABASE_URL', 'SUPABASE_DB_URL'):
            if key in env:
                assert '@rhi-uat-db:5432/' + ACTIVE in env[key], (name, key)
    marker = requests.get('http://127.0.0.1:18080/__rhi/uat', timeout=10).json()
    assert marker['database'] == ACTIVE and marker['provider_delivery'] is False


def save(run, report):
    (run / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


def command(args, log):
    with log.open('w') as out:
        subprocess.run(args, stdout=out, stderr=subprocess.STDOUT, check=True)


def prepare(delta):
    isolation()
    assert shutil.disk_usage(ROOT).free > 40 * 1024**3, 'Insufficient room for independent recoverable copies'
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    run = ROOT / 'refreshes' / stamp
    run.mkdir(parents=True, mode=0o700)
    candidate = 'rhi_uat_refresh_' + stamp.lower()
    report = {'source_database': 'postgres', 'target_database': ACTIVE,
              'candidate_database': candidate, 'snapshot_utc': stamp,
              'production_data_written': False, 'tables': [], 'state': 'preparing'}
    save(run, report)
    source = delta.connection_target(admin=True)
    source.set_session(isolation_level='REPEATABLE READ', readonly=True)
    try:
        with source.cursor() as cur:
            cur.execute("SET LOCAL timezone='UTC'; SET LOCAL search_path=public; SET LOCAL statement_timeout='180s'")
            cur.execute('SELECT pg_export_snapshot()')
            snapshot = cur.fetchone()[0]
            cur.execute('SELECT schemaname,tablename FROM pg_tables WHERE schemaname = ANY(%s) ORDER BY 1,2', (list(SCHEMAS),))
            tables = cur.fetchall()
            cur.execute("SELECT count(*) FROM public.orders WHERE service_date::date='2026-11-11'")
            report['orders_scheduled_2026_11_11'] = cur.fetchone()[0]
        with (run / 'source.dump').open('wb') as out, (run / 'dump.log').open('w') as err:
            subprocess.run(['docker', 'exec', 'supabase-db', 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres',
                            '-Fc', '--snapshot=' + snapshot, '--lock-wait-timeout=5s',
                            *[v for s in SCHEMAS for v in ('-n', s)]], stdout=out, stderr=err, check=True)
        print('Consistent live snapshot archived; calculating table fingerprints', flush=True)
        for schema, table in tables:
            columns, pk = delta.metadata(source, schema, table)
            hashes = delta.hashes(source, schema, table, pk)
            report['tables'].append({'schema': schema, 'table': table, 'columns': columns,
                                      'keys': pk, 'rows': len(hashes), 'digest': delta.digest(hashes)})
    finally:
        source.close()
    with (run / 'source.dump').open('rb') as stream:
        report['archive_sha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
    save(run, report)
    command(['docker', 'exec', 'supabase-db', 'createdb', '-U', 'supabase_admin', '-T', 'template0', candidate], run / 'createdb.log')
    with delta.connection_target(admin=True, database=candidate) as db, db.cursor() as cur:
        cur.execute('CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions; '
                    'CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions; '
                    'CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin; '
                    'CREATE SCHEMA storage AUTHORIZATION supabase_storage_admin; '
                    'CREATE SCHEMA supabase_migrations; CREATE SCHEMA rhi_migration; '
                    'CREATE SCHEMA _realtime AUTHORIZATION supabase_admin; CREATE PUBLICATION supabase_realtime')
        cur.execute(sql.SQL('REVOKE CONNECT ON DATABASE {} FROM PUBLIC').format(sql.Identifier(candidate)))
        cur.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO authenticator,supabase_auth_admin,supabase_storage_admin').format(sql.Identifier(candidate)))
    with (run / 'source.dump').open('rb') as archive, (run / 'restore.log').open('w') as log:
        subprocess.run(['docker', 'exec', '-i', 'supabase-db', 'pg_restore', '-U', 'supabase_admin', '-d', candidate,
                        '--single-transaction', '--exit-on-error', *[v for s in SCHEMAS for v in ('-n', s)]],
                       stdin=archive, stdout=log, stderr=log, check=True)
    with delta.connection_target(admin=True) as source, source.cursor() as cur:
        cur.execute('SELECT nspname,pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname=ANY(%s)', (list(SCHEMAS),))
        owners = cur.fetchall()
        cur.execute("SELECT nspname,CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,x.privilege_type,x.is_grantable FROM pg_namespace CROSS JOIN LATERAL aclexplode(nspacl) x WHERE nspname=ANY(%s)", (list(SCHEMAS),))
        grants = cur.fetchall()
    with delta.connection_target(admin=True, database=candidate) as db, db.cursor() as cur:
        for schema, owner in owners:
            cur.execute(sql.SQL('ALTER SCHEMA {} OWNER TO {}').format(sql.Identifier(schema), sql.Identifier(owner)))
        for schema, role, privilege, grantable in grants:
            assert privilege in ('USAGE', 'CREATE')
            cur.execute(sql.SQL('GRANT {} ON SCHEMA {} TO {}{}').format(sql.SQL(privilege), sql.Identifier(schema),
                sql.SQL('PUBLIC') if role == 'PUBLIC' else sql.Identifier(role), sql.SQL(' WITH GRANT OPTION' if grantable else '')))
        cur.execute("SELECT count(*) FROM pg_extension WHERE extname IN ('pg_cron','pg_net','supabase_vault')")
        assert cur.fetchone()[0] == 0, 'UAT must not acquire production schedulers/egress/Vault'
        cur.execute("SELECT count(*) FROM pg_trigger WHERE tgname IN ('rhi_preview_readonly','rhi_cutover_source_readonly')")
        assert cur.fetchone()[0] == 0, 'Unexpected production fence copied'
    with delta.connection_target(admin=True, database=candidate) as db:
        db.set_session(isolation_level='REPEATABLE READ', readonly=True)
        with db.cursor() as cur:
            cur.execute("SET LOCAL timezone='UTC'; SET LOCAL search_path=public")
        for entry in report['tables']:
            assert delta.metadata(db, entry['schema'], entry['table']) == (entry['columns'], entry['keys'])
            hashes = delta.hashes(db, entry['schema'], entry['table'], entry['keys'])
            assert delta.digest(hashes) == entry['digest'], entry['schema'] + '.' + entry['table']
    report['all_tables_matched'] = True
    save(run, report)
    print('All %d table fingerprints matched; copying independent Storage files' % len(tables), flush=True)
    original = Path('/opt/rhi/supabase/volumes/storage')
    copied = run / 'storage.new'
    copied.mkdir(mode=0o700)
    command(['cp', '-a', '--reflink=auto', str(original) + '/.', str(copied)], run / 'storage-copy.log')
    file_count = byte_count = 0
    for path in copied.rglob('*'):
        assert not path.is_symlink(), 'Unexpected Storage symlink'
        if not path.is_file():
            continue
        src = original / path.relative_to(copied)
        assert src.is_file() and src.stat().st_size == path.stat().st_size
        assert (src.stat().st_dev, src.stat().st_ino) != (path.stat().st_dev, path.stat().st_ino)
        with src.open('rb') as a, path.open('rb') as b:
            assert hashlib.file_digest(a, 'sha256').digest() == hashlib.file_digest(b, 'sha256').digest()
        file_count += 1
        byte_count += path.stat().st_size
    report['storage'] = {'files': file_count, 'bytes': byte_count, 'sha256_matched': True, 'independent_inodes': True}
    report['state'] = 'verified-ready'
    save(run, report)
    print(json.dumps({'run': str(run), 'tables': len(tables), 'storage': report['storage'], 'state': report['state']}), flush=True)


def activate(delta, name):
    assert Path(name).name == name and name.endswith('Z')
    run = ROOT / 'refreshes' / name
    report = json.loads((run / 'report.json').read_text())
    assert report['state'] == 'verified-ready' and report['all_tables_matched'] and report['storage']['sha256_matched']
    candidate = report['candidate_database']
    assert candidate == 'rhi_uat_refresh_' + name.lower()
    previous = 'rhi_uat_before_' + name.lower()
    isolation()
    command(['docker', 'stop', *SERVICES], run / 'stop.log')
    report['state'] = 'uat-stopped'
    save(run, report)
    admin = delta.connection_target(admin=True)
    admin.autocommit = True
    try:
        with admin.cursor() as cur:
            cur.execute('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=ANY(%s) AND pid<>pg_backend_pid()', ([ACTIVE, candidate],))
            cur.execute('SELECT slot_name,active FROM pg_replication_slots WHERE database=%s', (ACTIVE,))
            for slot, active in cur.fetchall():
                assert slot.endswith('_' + ACTIVE) and not active, 'Unexpected UAT replication slot'
                cur.execute('SELECT pg_drop_replication_slot(%s)', (slot,))
            cur.execute(sql.SQL('ALTER DATABASE {} RENAME TO {}').format(sql.Identifier(ACTIVE), sql.Identifier(previous)))
            try:
                cur.execute(sql.SQL('ALTER DATABASE {} RENAME TO {}').format(sql.Identifier(candidate), sql.Identifier(ACTIVE)))
            except Exception:
                cur.execute(sql.SQL('ALTER DATABASE {} RENAME TO {}').format(sql.Identifier(previous), sql.Identifier(ACTIVE)))
                raise
    finally:
        admin.close()
    report.update(state='database-swapped', previous_database=previous)
    save(run, report)
    (ROOT / 'storage').rename(run / 'storage.previous')
    (run / 'storage.new').rename(ROOT / 'storage')
    report['state'] = 'storage-swapped'
    save(run, report)
    command(['docker', 'start', *SERVICES], run / 'start.log')
    # Nginx resolves upstream container names at load time; Docker may allocate
    # different UAT addresses after the services restart in a different order.
    command(['docker', 'exec', 'rhi-uat-gateway', 'nginx', '-t'], run / 'gateway-check.log')
    command(['docker', 'exec', 'rhi-uat-gateway', 'nginx', '-s', 'reload'], run / 'gateway-reload.log')
    report['state'] = 'activated-needs-health-check'
    save(run, report)
    (ROOT / 'latest-refresh.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'state': report['state'], 'previous_database': previous, 'snapshot_utc': report['snapshot_utc']}), flush=True)
    keys = json.loads((ROOT / 'keys.json').read_text())
    headers = {'apikey': keys['SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + keys['SERVICE_ROLE_KEY'], 'Prefer': 'count=exact'}
    expected = next(t['rows'] for t in report['tables'] if t['schema'] == 'public' and t['table'] == 'orders')
    for attempt in range(30):
        try:
            auth = requests.get('http://127.0.0.1:18080/auth/v1/health', timeout=5)
            rest = requests.get('http://127.0.0.1:18080/rest/v1/orders?select=id&limit=0', headers=headers, timeout=5)
            if auth.ok and rest.ok and rest.headers.get('Content-Range', '').endswith('/' + str(expected)):
                break
        except requests.RequestException:
            pass
        time.sleep(2)
    else:
        report['state'] = 'activated-health-failed-recovery-required'
        save(run, report)
        raise RuntimeError('UAT health failed; previous database and storage remain preserved')
    isolation()
    report.update(state='active-verified', health={'auth': auth.status_code, 'orders_rest': rest.status_code,
                  'orders_count': expected}, verified_utc=datetime.datetime.now(datetime.timezone.utc).isoformat())
    save(run, report)
    (ROOT / 'latest-refresh.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'state': report['state'], 'orders': expected, 'snapshot_utc': report['snapshot_utc']}), flush=True)


if __name__ == '__main__':
    assert os.geteuid() == 0 and socket.gethostname().split('.')[0] == 'srv2126686'
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('prepare', 'activate'))
    parser.add_argument('run', nargs='?')
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('delta', '/opt/rhi/migration/plan-delta.py')
    delta = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(delta)
    prepare(delta) if args.action == 'prepare' else activate(delta, args.run)
