#!/usr/bin/env python3
"""Compare every restored row with the immutable, locally restored source archive.

Ordered hashes of canonical JSON rows cover all columns, including password
hashes and JSON data, without printing records or credentials.
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
counts = json.loads((backup / 'row-counts.json').read_text())
exclusions = json.loads(Path('/opt/rhi/migration/restore-exclusions.json').read_text())
excluded = {(x['schema'], x['table']) for x in exclusions}

def psql(database, statement):
    return ['docker', 'exec', 'supabase-db', 'psql', '-U', 'supabase_admin', '-d', database,
            '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement]

def scalar(database, statement):
    return subprocess.check_output(psql(database, statement), text=True).strip()

def table_hash(database, table):
    query = f'COPY (SELECT md5(to_jsonb(t)::text) AS h FROM {table} t ORDER BY h) TO STDOUT'
    process = subprocess.Popen(psql(database, query), stdout=subprocess.PIPE)
    checksum = hashlib.sha256()
    for block in iter(lambda: process.stdout.read(1024 * 1024), b''):
        checksum.update(block)
    assert process.wait() == 0
    return checksum.hexdigest()

results = []
for entry in counts:
    schema, table = entry['schema'], entry['table']
    assert all(c.isalnum() or c == '_' for c in schema + table)
    identifier = f'"{schema}"."{table}"'
    reference_count = int(scalar('rhi_source_snapshot', f'SELECT count(*) FROM {identifier}'))
    assert reference_count == entry['rows'], 'Archive/reference does not match original snapshot'
    if (schema, table) in excluded:
        results.append({**entry, 'status': 'documented_service_internal_exclusion'})
        continue
    target_count = int(scalar('postgres', f'SELECT count(*) FROM {identifier}'))
    reference_hash = table_hash('rhi_source_snapshot', identifier)
    target_hash = table_hash('postgres', identifier)
    result = {**entry, 'target_rows': target_count, 'source_sha256': reference_hash,
              'target_sha256': target_hash,
              'status': 'matched' if target_count == reference_count and target_hash == reference_hash else 'MISMATCH'}
    results.append(result)
    if len(results) % 10 == 0:
        print(json.dumps({'checked': len(results), 'total': len(counts)}), flush=True)
(backup / 'database-restore-verification.json').write_text(json.dumps(results, indent=2))
mismatches = sum(x['status'] == 'MISMATCH' for x in results)
print(json.dumps({'tables': len(results), 'matched': sum(x['status'] == 'matched' for x in results),
                  'documented_exclusions': len(excluded), 'mismatches': mismatches}), flush=True)
assert mismatches == 0
