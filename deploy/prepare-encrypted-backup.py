#!/usr/bin/env python3
"""Prepare and verify an encrypted migration backup before off-site transfer.

This creates a LOCAL Restic repository. It is not an off-site backup and does
not enable a recurring backup schedule. Accepts immutable verified snapshots;
never backs up a live PostgreSQL data directory or prints the recovery key.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('delta_snapshot')
    parser.add_argument('database_backup')
    args = parser.parse_args()
    assert os.geteuid() == 0 and socket.gethostname().split('.')[0] == 'srv2126686'
    os.umask(0o077)
    lock = open('/run/lock/rhi-encrypted-backup.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    snapshot, database = Path(args.delta_snapshot).resolve(), Path(args.database_backup).resolve()
    assert snapshot.parent == Path('/opt/rhi/backups') and snapshot.name.startswith('delta-')
    assert database.parent == Path('/opt/rhi/backups/daily-database')
    assert json.loads((snapshot / 'sequences-reconciled.json').read_text())['complete']
    applied = json.loads((snapshot / 'applied.json').read_text())
    assert not applied['rolled_back'] and all(row['matched'] for row in applied['verified'])
    rehearsals = [json.loads(p.read_text()) for p in database.glob('rhi_backup_rehearsal_*.json')]
    rehearsal = next((row for row in rehearsals if row.get('all_matched')
                      and row['archive_sha256'] == sha256(database / 'postgres.dump')), None)
    assert rehearsal, 'Clean restore rehearsal for this archive required'
    subprocess.run(['sha256sum', '-c', 'SHA256SUMS'], cwd=database, check=True)
    objects = json.loads((snapshot / 'storage-objects.json').read_text())
    inventory = json.loads(subprocess.check_output(['docker', 'exec', 'supabase-db',
        'psql', '-U', 'supabase_admin', '-d', rehearsal['database'], '-Atc',
        'SELECT coalesce(json_agg(o),\'[]\'::json) FROM storage.objects o'], text=True))
    def identity(obj):
        return (obj['id'], obj['bucket_id'], obj['name'], obj['version'],
                obj['metadata']['size'], obj['metadata'].get('eTag'))
    assert sorted(map(identity, objects)) == sorted(map(identity, inventory)), \
        'Database archive and Storage snapshot are not the same object set'
    for obj in objects:
        blob = snapshot / 'storage-files' / obj['id']
        assert blob.resolve().parent == snapshot / 'storage-files'
        receipt = json.loads(blob.with_name(blob.name + '.json').read_text())
        assert obj['version'] == receipt['source_version']
        assert sha256(blob) == receipt['sha256'], 'Storage checksum mismatch'
    print('Verified immutable Storage files:', len(objects), flush=True)
    private = Path('/opt/rhi/migration')
    password = private / 'restic.password'
    if not password.exists():
        with password.open('x') as stream:
            stream.write(secrets.token_urlsafe(48) + '\n')
    password.chmod(0o600)
    assert password.stat().st_size > 40
    repository = Path('/opt/rhi/backups/encrypted-migration')
    env = {**os.environ, 'RESTIC_REPOSITORY': str(repository), 'RESTIC_PASSWORD_FILE': str(password)}
    logdir = private / 'encrypted-backup-verification'
    logdir.mkdir(mode=0o700, exist_ok=True)

    def run(arguments, logfile):
        with (logdir / logfile).open('w') as log:
            subprocess.run(['restic', *arguments], env=env, stdout=log, stderr=subprocess.STDOUT, check=True)

    if not (repository / 'config').exists():
        assert not repository.exists() or not any(repository.iterdir()), 'Refuse a nonempty unknown repository'
        run(['init'], 'init.log')
    run(['backup', '--json', '--tag', 'migration-rehearsal', str(snapshot), str(database)], 'backup.jsonl')
    summaries = [json.loads(line) for line in (logdir / 'backup.jsonl').read_text().splitlines()
                 if line.startswith('{')]
    summary = next(row for row in reversed(summaries) if row.get('message_type') == 'summary')
    snapshot_id = summary['snapshot_id']
    print('Encrypted snapshot created; verifying all repository data', flush=True)
    run(['check', '--read-data'], 'check.log')
    # Restore both the full database archive and the largest Storage object.
    sample = max(objects, key=lambda obj: int(obj['metadata']['size']))
    originals = [database / 'postgres.dump', snapshot / 'storage-files' / sample['id']]
    restored = logdir / ('restore-' + snapshot_id)
    assert not restored.exists(), 'Refuse to overwrite prior restore verification'
    command = ['restore', snapshot_id, '--target', str(restored)]
    for original in originals:
        command += ['--include', str(original)]
    run(command, 'restore.log')
    for original in originals:
        assert sha256(original) == sha256(restored / original.relative_to('/')), 'Restored bytes differ'
    report = {'repository': str(repository), 'snapshot_id': snapshot_id,
              'storage_objects': len(objects), 'full_repository_read_check': True,
              'database_and_storage_restore_checksums': True, 'offsite_uploaded': False,
              'source_snapshot': str(snapshot), 'database_backup': str(database)}
    (logdir / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    # Only disposable files created by this invocation, after byte verification.
    shutil.rmtree(restored)
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
