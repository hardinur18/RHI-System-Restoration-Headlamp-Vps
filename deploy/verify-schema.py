#!/usr/bin/env python3
"""Compare operational application definitions and effective API privileges."""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess

assert socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
queries = {
    'tables_rls_replica_identity': """select c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relreplident
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind in ('r','p')""",
    'policies': """select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
        from pg_policies where schemaname in ('public','storage')""",
    'constraints': """select c.relname,k.conname,pg_get_constraintdef(k.oid) as definition
        from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public'""",
    'indexes': "select tablename,indexname,indexdef from pg_indexes where schemaname='public'",
    'triggers': """select c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition
        from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and not t.tgisinternal""",
    'functions': """select p.proname,pg_get_function_identity_arguments(p.oid) as args,
        pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.prokind in ('f','p')""",
    'realtime_membership': "select pubname,schemaname,tablename,attnames,rowfilter from pg_publication_tables where schemaname='public'",
    'api_table_privileges': """select c.relname,r.name as role,p.privilege,
        has_table_privilege(r.name,c.oid,p.privilege) as allowed
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        cross join (values ('anon'),('authenticated'),('service_role')) r(name)
        cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege)
        where n.nspname='public' and c.relkind in ('r','p','v')""",
    'api_function_privileges': """select p.proname,pg_get_function_identity_arguments(p.oid) as args,
        r.name as role,has_function_privilege(r.name,p.oid,'EXECUTE') as allowed
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        cross join (values ('anon'),('authenticated'),('service_role')) r(name)
        where n.nspname='public' and p.prokind in ('f','p')""",
    'sequence_values': """select schemaname,sequencename,last_value,start_value,min_value,max_value,
        increment_by,cycle,cache_size from pg_sequences where schemaname in ('public','auth','storage')""",
}
results = []
for name, query in queries.items():
    values = []
    for database in ('rhi_source_snapshot', 'postgres'):
        command = ['docker', 'exec', 'supabase-db', 'psql', '-U', 'supabase_admin', '-d', database,
                   '-At', '-v', 'ON_ERROR_STOP=1', '-c',
                   'select coalesce(jsonb_agg(to_jsonb(x)),\'[]\'::jsonb) from (' + query + ') x']
        rows = json.loads(subprocess.check_output(command, text=True))
        canonical = '\n'.join(sorted(json.dumps(r, sort_keys=True) for r in rows))
        values.append({'count': len(rows), 'sha256': hashlib.sha256(canonical.encode()).hexdigest()})
    result = {'category': name, 'source': values[0], 'target': values[1], 'matched': values[0] == values[1]}
    results.append(result)
    print(name, 'MATCH' if result['matched'] else 'MISMATCH', values[0]['count'], flush=True)
Path('/opt/rhi/migration/schema-verification.json').write_text(json.dumps(results, indent=2))
assert all(x['matched'] for x in results)
