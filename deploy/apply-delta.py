#!/usr/bin/env python3
"""Apply a reviewed delta only to the isolated staging target, atomically.

Requires all writers stopped, a matching fresh target baseline, and validated
Storage bytes for the plan's snapshot. Makes a rollback archive first. Enforces
every FK after replacing changed rows, then verifies all row hashes before
committing. Source database credentials are never used by this program.
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
from psycopg2 import sql

spec = importlib.util.spec_from_file_location('delta', Path(__file__).with_name('plan-delta.py'))
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('plan')
    parser.add_argument('--rollback-rehearsal', action='store_true', help='Run all mutations/verifications then roll back')
    parser.add_argument('--isolated-rehearsal-database', help='Replay a historical plan only on a new private rhi_delta_rehearsal_<digits> database')
    args = parser.parse_args()
    assert socket.gethostname().split('.')[0] == 'srv2126686'
    os.umask(0o077)
    directory = Path(args.plan).resolve()
    assert directory.parent == Path('/opt/rhi/backups') and directory.name.startswith('delta-')
    manifest = json.loads((directory / 'manifest.json').read_text())
    assert 'sequences' in manifest, 'Source sequence inventory required'
    assert manifest['transformation'] == {'old': delta.OLD, 'new': delta.NEW}
    assert len(manifest['tables']) >= 100
    isolated = args.isolated_rehearsal_database
    if isolated:
        assert args.rollback_rehearsal, 'An isolated rehearsal must roll back'
        assert re.fullmatch(r'rhi_delta_rehearsal_\d+', isolated)
        rehearsal_root = Path('/opt/rhi/migration/rehearsals') / isolated
        ownership = json.loads((rehearsal_root / 'created.json').read_text())
        assert ownership == {'database': isolated, 'plan': str(directory), 'purpose': 'disposable-delta-rehearsal'}
    else:
        assert not (directory / 'applied.json').exists(), 'This delta was already applied'
    running = subprocess.check_output(['docker', 'ps', '--format', '{{.Names}}'], text=True).splitlines()
    assert isolated or not set(running) & {'supabase-edge-functions', 'supabase-auth', 'supabase-storage',
        'supabase-rest', 'realtime-dev.supabase-realtime'}
    # Changed/new bytes must be present before database object versions change.
    objects = json.loads((directory / 'storage-objects.json').read_text())
    root = Path('/opt/rhi/supabase/volumes/storage/stub/stub').resolve()
    for obj in objects:
        receipt = json.loads((directory / 'storage-files' / (obj['id'] + '.json')).read_text())
        assert receipt['source_version'] == obj['version']
        path = root / obj['bucket_id'] / obj['name']
        if obj.get('version'):
            path /= obj['version']
        path = path.resolve()
        assert path.is_relative_to(root)
        with path.open('rb') as stream:
            assert hashlib.file_digest(stream, 'sha256').hexdigest() == receipt['sha256']
    print('Storage snapshot bytes verified', flush=True)
    payloads = {}
    for entry in manifest['tables']:
        path = (directory / entry['file']).resolve()
        assert path.parent == directory
        data = path.read_bytes()
        assert hashlib.sha256(data).hexdigest() == entry['file_sha256']
        payloads[entry['file']] = json.loads(data)
    rollback = directory / 'target-before-delta.dump'
    assert not isolated or rollback.exists(), 'Historical rollback archive required'
    if not rollback.exists():
        with rollback.open('wb') as archive:
            subprocess.run(['docker', 'exec', 'supabase-db', 'pg_dump', '-U', 'supabase_admin', '-Fc', 'postgres'],
                           stdout=archive, check=True)
        with rollback.open('rb') as stream:
            (directory / 'rollback-sha256.txt').write_text(hashlib.file_digest(stream, 'sha256').hexdigest() + '\n')
    target = delta.connection_target(admin=True, database=isolated or 'postgres')
    verified = []
    try:
        with target.cursor() as cur:
            cur.execute("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='300s'; SET LOCAL timezone='UTC'; SET LOCAL search_path=public")
            cur.execute('SELECT current_database()')
            assert cur.fetchone()[0] == (isolated or 'postgres')
            if isolated:
                cur.execute("SELECT to_regclass('cron.job')")
                assert cur.fetchone()[0] is None, 'No scheduler may be restored into a rehearsal database'
                cur.execute('SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()')
                assert cur.fetchone()[0] == 0, 'No services may use this rehearsal database'
            else:
                cur.execute('SHOW cron.launch_active_jobs')
                assert cur.fetchone()[0] == 'off'
                cur.execute('SELECT count(*) FROM cron.job WHERE active')
                assert cur.fetchone()[0] == 0
            for entry in manifest['tables']:
                cur.execute(sql.SQL('LOCK TABLE {} IN ACCESS EXCLUSIVE MODE').format(sql.Identifier(entry['schema'], entry['table'])))
        for entry in manifest['tables']:
            schema, table, keys = entry['schema'], entry['table'], entry['keys']
            columns, target_keys = delta.metadata(target, schema, table)
            assert [list(x) for x in columns] == entry['columns'] and keys == target_keys, 'Schema drift: ' + schema + '.' + table
            current = delta.hashes(target, schema, table, keys)
            assert delta.digest(current) == entry['target_digest'], 'Target changed since plan: ' + schema + '.' + table
        print('All target preconditions matched; applying transactional delta', flush=True)
        with target.cursor() as cur:
            cur.execute('SET LOCAL session_replication_role=replica')
            # Delete changed rows across all tables first: handles unique-key
            # swaps without transient conflicts. FK integrity is checked below.
            for entry in manifest['tables']:
                payload = payloads[entry['file']]
                table = sql.Identifier(entry['schema'], entry['table'])
                if entry.get('replace_all'):
                    cur.execute(sql.SQL('DELETE FROM {}').format(table))
                elif payload['delete_keys']:
                    query = sql.SQL('DELETE FROM {} t USING jsonb_populate_recordset(NULL::{},%s::jsonb) k WHERE {}').format(
                        table, table, sql.SQL(' AND ').join(sql.SQL('{}={}').format(
                            sql.Identifier('t', k), sql.Identifier('k', k)) for k in entry['keys']))
                    cur.execute(query, (json.dumps(payload['delete_keys']),))
            for entry in manifest['tables']:
                payload = payloads[entry['file']]
                # Old reviewed snapshots remain readable. New plans transport
                # raw JSON text so arbitrary-precision numbers are never floats.
                raw_rows = 'rows_json' in payload
                rows = payload['rows_json'] if raw_rows else payload['rows']
                table = sql.Identifier(entry['schema'], entry['table'])
                columns = [name for name, _, generated, _ in entry['columns'] if not generated]
                names = sql.SQL(',').join(map(sql.Identifier, columns))
                for offset in range(0, len(rows), 1000):
                    query = sql.SQL('INSERT INTO {} ({}) OVERRIDING SYSTEM VALUE SELECT {} FROM jsonb_populate_recordset(NULL::{},%s::jsonb)').format(
                        table, names, names, table)
                    batch = rows[offset:offset + 1000]
                    encoded = '[' + ','.join(batch) + ']' if raw_rows else json.dumps(batch)
                    cur.execute(query, (encoded,))
            # Normal FK triggers were suppressed to avoid side effects/reordering.
            # Check ALL imported references explicitly, including unchanged rows.
            cur.execute("""select conname,conrelid::regclass::text,confrelid::regclass::text,
                confmatchtype, array(select attname from unnest(conkey) with ordinality k(n,o)
                  join pg_attribute a on a.attrelid=conrelid and a.attnum=k.n order by k.o),
                array(select attname from unnest(confkey) with ordinality k(n,o)
                  join pg_attribute a on a.attrelid=confrelid and a.attnum=k.n order by k.o)
                from pg_constraint c join pg_namespace n on n.oid=c.connamespace
                where contype='f' and n.nspname in ('public','auth','storage','supabase_migrations')""")
            for name, child, parent, match, ck, pk in cur.fetchall():
                assert match in ('s', 'f')
                nonnull = sql.SQL(' AND ').join(sql.SQL('{} IS NOT NULL').format(sql.Identifier('c', k)) for k in ck)
                join = sql.SQL(' AND ').join(sql.SQL('{}={}').format(sql.Identifier('c', a), sql.Identifier('p', b)) for a, b in zip(ck, pk))
                invalid = sql.SQL('({}) AND NOT EXISTS (SELECT 1 FROM {} p WHERE {})').format(nonnull, sql.SQL(parent), join)
                if match == 'f':
                    any_nonnull = sql.SQL(' OR ').join(sql.SQL('{} IS NOT NULL').format(sql.Identifier('c', k)) for k in ck)
                    invalid = sql.SQL('({}) OR (({}) AND NOT ({}))').format(invalid, any_nonnull, nonnull)
                cur.execute(sql.SQL('SELECT count(*) FROM {} c WHERE {}').format(sql.SQL(child), invalid))
                assert cur.fetchone()[0] == 0, 'Foreign-key mismatch: ' + name
        print('All foreign keys verified; checking final row digests', flush=True)
        for entry in manifest['tables']:
            final = delta.hashes(target, entry['schema'], entry['table'], entry['keys'])
            assert len(final) == entry['source_count'] and delta.digest(final) == entry['source_digest'], \
                'Post-apply row mismatch: ' + entry['schema'] + '.' + entry['table']
            verified.append({'schema': entry['schema'], 'table': entry['table'], 'rows': len(final), 'matched': True})
        # No sequence changes in transaction: sequence setval is not rolled back.
        # Current migrated sequence is Auth refresh_tokens; reconcile only after
        # successful commit, while all writers remain stopped.
        if args.rollback_rehearsal:
            target.rollback()
            receipt = 'rollback-rehearsal.json'
        else:
            target.commit()
            receipt = 'applied.json'
        receipt_root = rehearsal_root if isolated else directory
        (receipt_root / receipt).write_text(json.dumps({'rolled_back': args.rollback_rehearsal,
            'database': isolated or 'postgres', 'verified': verified}, indent=2))
        if not args.rollback_rehearsal:
            with target, target.cursor() as cur:
                for sequence in manifest['sequences']:
                    if sequence['last_value'] is None:
                        continue
                    identifier = sql.Identifier(sequence['schema'], sequence['name'])
                    cur.execute(sql.SQL('SELECT last_value FROM {}').format(identifier))
                    value = max(cur.fetchone()[0], sequence['last_value'])
                    cur.execute('SELECT setval(%s::regclass,%s,true)',
                        (sequence['schema'] + '.' + sequence['name'], value))
            (directory / 'sequences-reconciled.json').write_text(json.dumps({'complete': True}))
        print(json.dumps({'verified_tables': len(verified), 'rolled_back': args.rollback_rehearsal}), flush=True)
    except BaseException:
        target.rollback()
        raise
    finally:
        target.close()


if __name__ == '__main__':
    main()
