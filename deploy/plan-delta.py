#!/usr/bin/env python3
"""Prepare a consistent, read-only source delta for the private RHI staging DB.

Compares all row hashes, including deletes and tables without updated_at.
Never prints row contents. Does not write to either database. The resulting
private plan records target preconditions and source verification digests.
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

OLD = 'https://dhnxwrteolnjdrxlmgwi.supabase.co/storage/v1/object/public/'
NEW = 'https://api-rhi.polesheadlamp.id/storage/v1/object/public/'
ASSET_TABLES = {('public', 'orders'), ('public', 'profiles'), ('public', 'kv_store_f781cd00')}
EXCLUDED = {('auth', 'schema_migrations'), ('storage', 'migrations'),
            ('storage', 'bucket_lifecycle_states'), ('storage', 'lifecycle_abandoned_artifacts')}


def connection_target(admin=False, database='postgres'):
    env = dict(line.split('=', 1) for line in Path('/opt/rhi/supabase/.env').read_text().splitlines()
               if '=' in line and not line.startswith('#'))
    inspect = json.loads(subprocess.check_output(['docker', 'inspect', 'supabase-db']))[0]
    ip = next(iter(inspect['NetworkSettings']['Networks'].values()))['IPAddress']
    return psycopg2.connect(host=ip, user='supabase_admin' if admin else 'postgres', password=env['POSTGRES_PASSWORD'],
                            dbname=database, connect_timeout=15)


def metadata(conn, schema, table):
    with conn.cursor() as cur:
        cur.execute("""select a.attname,format_type(a.atttypid,a.atttypmod),a.attgenerated,a.attidentity
            from pg_attribute a where a.attrelid=%s::regclass and a.attnum>0 and not a.attisdropped
            order by a.attnum""", (schema + '.' + table,))
        columns = cur.fetchall()
        cur.execute("""select a.attname from pg_index i
            cross join unnest(i.indkey) with ordinality k(num,ord)
            join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.num
            where i.indrelid=%s::regclass and i.indisprimary order by k.ord""", (schema + '.' + table,))
        keys = [r[0] for r in cur.fetchall()]
    return columns, keys


def row_expression(schema, table, transform):
    expression = sql.SQL('to_jsonb(t)::text')
    if transform and (schema, table) in ASSET_TABLES:
        expression = sql.SQL('replace({}, {}, {})::jsonb::text').format(expression, sql.Literal(OLD), sql.Literal(NEW))
    return expression


def hashes(conn, schema, table, keys, transform=False):
    key_expr = (sql.SQL('jsonb_build_array({})::text').format(
        sql.SQL(',').join(sql.Identifier('t', key) for key in keys)) if keys else sql.SQL('NULL::text'))
    query = sql.SQL('SELECT {}, md5({}) FROM {} t').format(
        key_expr, row_expression(schema, table, transform), sql.Identifier(schema, table))
    with conn.cursor(name='hash_' + table) as cur:
        cur.itersize = 4000
        cur.execute(query)
        result = cur.fetchall()
    if keys:
        mapping = dict(result)
        assert len(mapping) == len(result), 'Primary keys must be unique'
        return mapping
    return [r[1] for r in result]


def digest(value):
    rows = sorted(value.items()) if isinstance(value, dict) else sorted(value)
    checksum = hashlib.sha256()
    for row in rows:
        checksum.update((json.dumps(row, ensure_ascii=True, separators=(',', ':')) + '\n').encode())
    return checksum.hexdigest()


def main():
    assert socket.gethostname().split('.')[0] == 'srv2126686'
    os.umask(0o077)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    output = Path('/opt/rhi/backups') / ('delta-' + stamp)
    output.mkdir(mode=0o700)
    os.environ['PGPASSFILE'] = '/opt/rhi/migration/source.pgpass'
    source = psycopg2.connect('host=aws-1-ap-south-1.pooler.supabase.com port=5432 dbname=postgres '
        'user=postgres.dhnxwrteolnjdrxlmgwi sslmode=require connect_timeout=15')
    target = connection_target()
    source.set_session(isolation_level='REPEATABLE READ', readonly=True)
    target.set_session(isolation_level='REPEATABLE READ', readonly=True)
    manifest = {'started_utc': stamp, 'source_readonly': True, 'target_readonly': True,
                'transformation': {'old': OLD, 'new': NEW}, 'tables': [], 'excluded': []}
    with source, target:
        for conn in (source, target):
            with conn.cursor() as cur:
                cur.execute("set local statement_timeout='180s'; set local lock_timeout='5s'; set local timezone='UTC'; set local search_path=public")
        with source.cursor() as cur:
            cur.execute("select pg_export_snapshot()")
            manifest['snapshot'] = cur.fetchone()[0]
            cur.execute("""select schemaname,tablename from pg_tables where schemaname in
                ('public','auth','storage','supabase_migrations') order by 1,2""")
            tables = cur.fetchall()
        for schema, table in tables:
            if (schema, table) in EXCLUDED:
                with source.cursor() as cur:
                    cur.execute(sql.SQL('select count(*) from {}').format(sql.Identifier(schema, table)))
                    count = cur.fetchone()[0]
                if table not in ('schema_migrations', 'migrations'):
                    assert count == 0, 'Previously empty cloud internal table now contains data'
                manifest['excluded'].append({'schema': schema, 'table': table, 'rows': count})
                continue
            columns, keys = metadata(source, schema, table)
            assert (columns, keys) == metadata(target, schema, table), 'Schema drift requires separate review: ' + schema + '.' + table
            original = hashes(source, schema, table, keys, transform=True)
            current = hashes(target, schema, table, keys)
            entry = {'schema': schema, 'table': table, 'columns': columns, 'keys': keys,
                     'source_count': len(original), 'target_count': len(current),
                     'source_digest': digest(original), 'target_digest': digest(current)}
            rows = []
            removed = []
            changed = []
            if keys:
                removed = sorted(set(current) - set(original))
                changed = sorted(key for key, value in original.items() if current.get(key) != value)
                entry['inserted'] = sum(key not in current for key in changed)
                entry['updated'] = len(changed) - entry['inserted']
                entry['deleted'] = len(removed)
                for offset in range(0, len(changed), 1000):
                    records = [dict(zip(keys, json.loads(key))) for key in changed[offset:offset + 1000]]
                    # Keep the PostgreSQL JSON text intact: Python float decoding
                    # can round numeric columns and numbers nested inside jsonb.
                    query = sql.SQL('SELECT {} FROM {} t JOIN jsonb_populate_recordset(NULL::{},%s::jsonb) k ON {}').format(
                        row_expression(schema, table, True), sql.Identifier(schema, table), sql.Identifier(schema, table),
                        sql.SQL(' AND ').join(sql.SQL('{}={}').format(sql.Identifier('t', k), sql.Identifier('k', k)) for k in keys))
                    with source.cursor() as cur:
                        cur.execute(query, (json.dumps(records),))
                        rows.extend(r[0] for r in cur.fetchall())
                assert len(rows) == len(changed)
            elif entry['source_digest'] != entry['target_digest']:
                # No primary key: explicit complete replacement preserves duplicates.
                with source.cursor() as cur:
                    cur.execute(sql.SQL('select {} from {} t').format(
                        row_expression(schema, table, True), sql.Identifier(schema, table)))
                    rows = [r[0] for r in cur.fetchall()]
                entry['replace_all'] = True
                entry['inserted'], entry['updated'], entry['deleted'] = len(rows), 0, len(current)
            else:
                entry['inserted'], entry['updated'], entry['deleted'] = 0, 0, 0
            payload = {'rows_json': rows, 'delete_keys': [dict(zip(keys, json.loads(k))) for k in removed + changed]}
            filename = schema + '.' + table + '.json'
            data = (json.dumps(payload, ensure_ascii=True, separators=(',', ':')) + '\n').encode()
            (output / filename).write_bytes(data)
            entry['file'] = filename
            entry['file_sha256'] = hashlib.sha256(data).hexdigest()
            manifest['tables'].append(entry)
            print(json.dumps({k: entry[k] for k in ('schema', 'table', 'source_count', 'inserted', 'updated', 'deleted')}), flush=True)
        # Storage inventory shares the exact same snapshot as database changes.
        for filename, query in [('storage-objects.json', 'select row_to_json(o) from storage.objects o order by bucket_id,name'),
                                ('storage-buckets.json', 'select row_to_json(b) from storage.buckets b order by id')]:
            with source.cursor() as cur:
                cur.execute(query)
                (output / filename).write_text(json.dumps([r[0] for r in cur.fetchall()], default=str))
        with source.cursor() as cur:
            cur.execute("""select schemaname,sequencename,last_value from pg_sequences
                where schemaname in ('public','auth','storage','supabase_migrations')""")
            manifest['sequences'] = [{'schema': a, 'name': b, 'last_value': c} for a, b, c in cur.fetchall()]
    manifest['completed_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print('Completed read-only delta plan: ' + str(output), flush=True)


if __name__ == '__main__':
    main()
