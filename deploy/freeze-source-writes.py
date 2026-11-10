#!/usr/bin/env python3
"""Reversible source business-write fence for an explicitly authorized cutover.

Cloud-managed Auth/Storage tables are not altered. Staff must stop uploads and
input; provider callbacks must be handed over before source retirement.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import socket

import psycopg2
from psycopg2 import sql

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('backup', help='Verified source-* archive on the dedicated VPS')
parser.add_argument('--apply', action='store_true', help='Otherwise rehearse then roll back')
args = parser.parse_args()
assert socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
backup = Path(args.backup).resolve()
assert backup.parent == Path('/opt/rhi/backups') and backup.name.startswith('source-')
verification = json.loads((backup / 'archive-verification.json').read_text())
with (backup / 'database.dump').open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == verification['sha256']
receipt = Path('/opt/rhi/migration/source-cutover-fence.json')
assert not receipt.exists(), 'Review an existing cutover before repeating it'
os.environ['PGPASSFILE'] = '/opt/rhi/migration/source.pgpass'
db = psycopg2.connect('host=aws-1-ap-south-1.pooler.supabase.com port=5432 dbname=postgres '
                     'user=postgres.dhnxwrteolnjdrxlmgwi sslmode=require connect_timeout=15')
try:
    with db.cursor() as cur:
        cur.execute("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'")
        cur.execute('SELECT jobid,jobname,active FROM cron.job ORDER BY jobid')
        jobs = [dict(zip(['id', 'name', 'active'], row)) for row in cur.fetchall()]
        assert {r['name'] for r in jobs} == {'ads-daily-auto-sync', 'ads-daily-seven-day-reconcile', 'meta-conversion-dispatcher'}
        cur.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
        tables = [row[0] for row in cur.fetchall()]
        assert len(tables) >= 70
        cur.execute("SELECT count(*) FROM pg_trigger WHERE tgname='rhi_cutover_source_readonly'")
        assert cur.fetchone()[0] == 0
        cur.execute('CREATE SCHEMA IF NOT EXISTS rhi_cutover; REVOKE ALL ON SCHEMA rhi_cutover FROM PUBLIC')
        cur.execute("""CREATE OR REPLACE FUNCTION rhi_cutover.reject_source_write() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN
            RAISE EXCEPTION 'RHI sedang migrasi. Jangan input di aplikasi lama; gunakan rhi.polesheadlamp.id setelah dinyatakan siap.' USING ERRCODE='25006';
            END $$""")
        for name in tables:
            cur.execute(sql.SQL('CREATE TRIGGER rhi_cutover_source_readonly BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON {} FOR EACH STATEMENT EXECUTE FUNCTION rhi_cutover.reject_source_write()').format(sql.Identifier('public', name)))
            cur.execute(sql.SQL('ALTER TABLE {} ENABLE ALWAYS TRIGGER rhi_cutover_source_readonly').format(sql.Identifier('public', name)))
        cur.execute('SELECT cron.alter_job(jobid, active := false) FROM cron.job')
        cur.execute('SAVEPOINT fence_probe')
        try:
            cur.execute('UPDATE public.orders SET id=id WHERE false')
        except psycopg2.Error as error:
            assert error.pgcode == '25006'
            cur.execute('ROLLBACK TO SAVEPOINT fence_probe')
        else:
            raise AssertionError('Source write fence did not reject mutation')
        cur.execute('SELECT count(*) FROM cron.job WHERE active')
        assert cur.fetchone()[0] == 0
    report = {'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'source_ref': 'dhnxwrteolnjdrxlmgwi', 'backup': str(backup),
              'tables': tables, 'prior_jobs': jobs, 'applied': args.apply,
              'scope': 'public business tables and cron; managed Auth/Storage unchanged'}
    if args.apply:
        # Save rollback information before committing any source change.
        receipt.with_suffix('.prepared.json').write_text(json.dumps(report, indent=2))
        db.commit()
        receipt.write_text(json.dumps(report, indent=2))
    else:
        db.rollback()
    print(json.dumps({'applied': args.apply, 'tables_fenced': len(tables), 'scheduler_jobs_paused': len(jobs), 'probe_rejected': True}))
finally:
    db.rollback()
    db.close()
