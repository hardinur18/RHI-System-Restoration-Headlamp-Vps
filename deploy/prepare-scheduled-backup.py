#!/usr/bin/env python3
"""Build readable VPS backup from a restored daily archive and versioned Storage.

Never reads Cloud production or compares a running database to an older dump.
CSV and Storage inventory come from the same restored archive. A missing or
changing blob fails the run. Only the disposable DB created here is removed.
"""
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess

assert socket.gethostname().split('.')[0] == 'srv2126686' and os.geteuid() == 0
os.umask(0o077)
lock = open('/run/lock/rhi-scheduled-prepare.lock', 'w')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
archive_lock = open('/run/lock/rhi-database-backup.lock', 'a')
fcntl.flock(archive_lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
root = Path('/opt/rhi/migration')
spec = importlib.util.spec_from_file_location('delta', root / 'plan-delta.py')
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)
backups = sorted(p for p in Path('/opt/rhi/backups/daily-database').iterdir()
                 if re.fullmatch(r'\d{8}T\d{6}Z', p.name) and (p / 'SHA256SUMS').is_file())
assert backups
backup = backups[-1]
age = datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.strptime(backup.name, '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc)
assert 0 <= age.total_seconds() < 26 * 3600, 'Daily database backup is stale'
subprocess.run(['sha256sum', '--quiet', '-c', 'SHA256SUMS'], cwd=backup, check=True)
package = Path('/opt/rhi/backups/readable') / backup.name
def ready_receipt():
    receipt = {'package': str(package), 'database_backup': backup.name,
               'prepared_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'source': 'vps', 'ready_for_upload': True}
    temporary = root / 'scheduled-backup-package.pending.json'
    temporary.write_text(json.dumps(receipt))
    temporary.replace(root / 'scheduled-backup-package.json')

if (package / 'SHA256SUMS').exists():
    subprocess.run(['sha256sum', '--quiet', '-c', 'SHA256SUMS'], cwd=package, check=True)
    ready_receipt()
    print(json.dumps({'package': str(package), 'reused': True}))
    raise SystemExit(0)
assert not package.exists(), 'Inspect incomplete readable package before retrying'
assert shutil.disk_usage('/opt/rhi').free > 15 * 1024**3, 'Insufficient space for an isolated restore'
database = 'rhi_backup_rehearsal_' + re.sub(r'\D', '', backup.name)
snapshot = Path('/opt/rhi/backups') / ('delta-' + backup.name)
assert not snapshot.exists(), 'Never replace an existing snapshot'
snapshot.mkdir(mode=0o700)
(snapshot / 'origin.json').write_text(json.dumps({'origin': 'vps-daily-database', 'archive': str(backup), 'database': database}))
conn = delta.connection_target(admin=True)
conn.autocommit = True
owned = False
base = ['docker', 'exec', 'supabase-db']
def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

try:
    with conn.cursor() as cur:
        cur.execute('select 1 from pg_database where datname=%s', (database,))
        assert cur.fetchone() is None, 'Never overwrite an existing database'
    subprocess.run(base + ['createdb', '-U', 'supabase_admin', '-T', 'template0', database], check=True)
    owned = True
    # No services or cron are connected to this private restore. Restoring only
    # application schemas cannot import cron.job or activate source schedulers.
    setup = ('CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions; '
             'CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions; CREATE SCHEMA auth; CREATE SCHEMA storage; '
             'CREATE SCHEMA supabase_migrations; CREATE SCHEMA rhi_migration; CREATE PUBLICATION supabase_realtime; '
             'REVOKE CONNECT ON DATABASE ' + database + ' FROM PUBLIC;')
    subprocess.run(base + ['psql', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', setup],
                   check=True, stdout=subprocess.DEVNULL)
    with (backup / 'postgres.dump').open('rb') as archive, (snapshot / 'restore.log').open('w') as log:
        subprocess.run(['docker', 'exec', '-i', 'supabase-db', 'pg_restore', '-U', 'supabase_admin', '-d', database,
                        '--single-transaction', '--exit-on-error', '--no-owner', '-n', 'auth', '-n', 'storage',
                        '-n', 'public', '-n', 'supabase_migrations', '-n', 'rhi_migration'], stdin=archive, stdout=log, stderr=log, check=True)
    report = {'database': database, 'archive_sha256': digest(backup / 'postgres.dump'),
              'archive_restore_verified': True, 'scope': 'Successful isolated archive restore; no live-database parity assertion'}
    (backup / (database + '.json')).write_text(json.dumps(report, indent=2))
    restored = delta.connection_target(admin=True, database=database)
    restored.set_session(readonly=True)
    with restored, restored.cursor() as cur:
        for table in ['objects', 'buckets']:
            cur.execute('select row_to_json(t) from storage.' + table + ' t order by id')
            rows = [r[0] for r in cur.fetchall()]
            (snapshot / ('storage-' + table + '.json')).write_text(json.dumps(rows, default=str))
    restored.close()
    objects = json.loads((snapshot / 'storage-objects.json').read_text())
    blobs = snapshot / 'storage-files'
    blobs.mkdir(mode=0o700)
    candidates = [p for p in Path('/opt/rhi/backups').glob('*/storage-files') if p != blobs]
    live_root = Path('/opt/rhi/supabase/volumes/storage/stub/stub').resolve()
    copied = reused = 0
    receipts = []
    for obj in objects:
        ident, version = obj['id'], obj.get('version')
        assert re.fullmatch(r'[0-9a-f-]{36}', ident)
        size = int(obj['metadata']['size'])
        dest = blobs / ident
        receipt = None
        for candidate in candidates:
            prior = candidate / (ident + '.json')
            old = candidate / ident
            if prior.is_file() and old.is_file() and not old.is_symlink():
                data = json.loads(prior.read_text())
                if data.get('source_version') == version and old.stat().st_size == size and digest(old) == data.get('sha256'):
                    os.link(old, dest)
                    receipt = data
                    reused += 1
                    break
        if receipt is None:
            parts = [obj['bucket_id'], obj['name']] + ([version] if version else [])
            assert all(isinstance(p, str) and not p.startswith('/') and all(v not in ('', '.', '..') for v in p.split('/')) for p in parts)
            source = live_root.joinpath(*parts)
            assert source.resolve().is_relative_to(live_root) and source.is_file() and not source.is_symlink()
            before = source.stat()
            assert before.st_size == size
            shutil.copyfile(source, dest)
            after = source.stat()
            assert (before.st_ino, before.st_size, before.st_mtime_ns) == (after.st_ino, after.st_size, after.st_mtime_ns)
            checksum = digest(dest)
            assert checksum == digest(source), 'Storage changed during backup; retry with a fresh archive'
            receipt = {'id': ident, 'bucket': obj['bucket_id'], 'name': obj['name'], 'source_version': version,
                       'bytes': size, 'sha256': checksum, 'content_type': obj['metadata'].get('mimetype')}
            copied += 1
        (blobs / (ident + '.json')).write_text(json.dumps(receipt))
        receipts.append(receipt)
    (snapshot / 'storage-verification.json').write_text(json.dumps(receipts))
    print(json.dumps({'storage_objects': len(objects), 'reused_immutable_files': reused, 'copied_new_versions': copied}), flush=True)
    subprocess.run(['python3', str(root / 'prepare-readable-backup.py'), str(snapshot), str(backup)], check=True)
    # This package is a VPS backup, not a fresh copy of the still-active Cloud app.
    note = package / 'BACA DULU.txt'
    note.write_text(note.read_text().replace('Aplikasi asal tetap berjalan.', 'Sumber salinan: database VPS RHI pada waktu arsip harian.'))
    subprocess.run(['python3', str(root / 'finalize-readable-backup.py'), str(package)], check=True)
    ready_receipt()
finally:
    conn.close()
    if owned:
        subprocess.run(base + ['dropdb', '-U', 'supabase_admin', database], check=True)
print(json.dumps({'package': str(package), 'ready_for_upload': True}))
