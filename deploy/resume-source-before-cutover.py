#!/usr/bin/env python3
"""Undo the source pause only while destination business writes remain fenced.

After destination writes start, reconcile those writes instead of using this.
"""
import importlib.util
import json
import os
from pathlib import Path
import socket
import psycopg2
from psycopg2 import sql

assert socket.gethostname().split('.')[0] == 'srv2126686'
root = Path('/opt/rhi/migration')
spec = importlib.util.spec_from_file_location('delta', root / 'plan-delta.py')
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)
target = delta.connection_target()
with target, target.cursor() as cur:
    cur.execute("SELECT count(*) FROM pg_trigger WHERE tgname='rhi_preview_readonly' AND tgenabled='A'")
    assert cur.fetchone()[0] >= 77, 'Target may accept writes; reconcile before rollback'
    cur.execute('SELECT count(*) FROM cron.job WHERE active')
    assert cur.fetchone()[0] == 0
target.close()
saved = json.loads((root / 'source-cutover-cron-before.json').read_text())
assert saved['source_ref'] == 'dhnxwrteolnjdrxlmgwi'
os.environ['PGPASSFILE'] = str(root / 'source.pgpass')
source = psycopg2.connect('host=aws-1-ap-south-1.pooler.supabase.com port=5432 dbname=postgres '
                         'user=postgres.dhnxwrteolnjdrxlmgwi sslmode=require connect_timeout=15')
with source, source.cursor() as cur:
    cur.execute("SET LOCAL lock_timeout='5s'")
    cur.execute("""SELECT n.nspname,c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE t.tgname='rhi_cutover_source_readonly' AND n.nspname='public'""")
    for schema, table in cur.fetchall():
        cur.execute(sql.SQL('DROP TRIGGER rhi_cutover_source_readonly ON {}').format(sql.Identifier(schema, table)))
    for job in saved['jobs']:
        cur.execute('SELECT cron.alter_job(%s,active := %s)', (job['id'], job['active']))
source.close()
print('Source business writes and prior scheduler state restored; target remains fenced')
