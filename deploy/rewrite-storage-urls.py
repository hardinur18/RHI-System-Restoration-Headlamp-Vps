#!/usr/bin/env python3
"""Repoint asset URLs only on the private target; preserve timestamps/history.

Require exact initial restore proof. Historical WhatsApp messages retain their
original text. Every rewritten value must equal the source value after applying
the one documented URL-prefix transformation.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
from urllib.parse import urlparse

assert socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
backup = Path('/opt/rhi/backups/source-20261104T082954Z')
proof = json.loads((backup / 'database-restore-verification.json').read_text())
assert len(proof) == 115 and all(x['status'] != 'MISMATCH' for x in proof)
old = 'https://dhnxwrteolnjdrxlmgwi.supabase.co/storage/v1/object/public/'
new = 'https://api-rhi.polesheadlamp.id/storage/v1/object/public/'
assert urlparse(old).hostname != urlparse(new).hostname
columns = [('orders', 'photos', 'jsonb'), ('profiles', 'avatar_url', 'text'),
           ('kv_store_f781cd00', 'value', 'jsonb')]
sql = 'BEGIN; SET session_replication_role=replica;\n'
for table, column, datatype in columns:
    sql += (f'UPDATE public."{table}" SET "{column}" = replace("{column}"::text, '
            f"'{old}', '{new}')::{datatype} WHERE strpos(\"{column}\"::text, '{old}') > 0;\n")
sql += 'COMMIT;\n'
path = Path('/opt/rhi/migration/rewrite-storage-urls.sql')
path.write_text(sql)
command = ['docker', 'exec', '-i', 'supabase-db', 'psql', '-U', 'supabase_admin', '-d', 'postgres',
           '-v', 'ON_ERROR_STOP=1']
result = subprocess.run(command, input=sql, text=True, capture_output=True)
assert result.returncode == 0, 'URL transformation rolled back'
Path('/opt/rhi/migration/rewrite-storage-urls.log').write_text(result.stdout + result.stderr)
print(result.stdout.strip())
