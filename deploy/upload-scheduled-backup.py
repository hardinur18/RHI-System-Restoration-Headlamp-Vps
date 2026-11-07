#!/usr/bin/env python3
"""Verified dated CSV/recovery backups with shared immutable photos in Drive.

The original fully verified backup is pinned. Only completed snapshots created
by this program are eligible for retention. No source application is contacted.
"""
import configparser
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

import requests

ROOT = Path('/opt/rhi/migration')
BASELINE = '20261106T063214Z'
PREFIX = 'Backup Otomatis'
MAGIC = 'rhi-vps-scheduled-backup-v1'


def digest(path, algorithm='sha256'):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, algorithm).hexdigest()


def write_json(path, data):
    temporary = path.with_name(path.name + '.pending')
    temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    temporary.replace(path)


def main():
    assert os.geteuid() == 0 and socket.gethostname().split('.')[0] == 'srv2126686'
    os.umask(0o077)
    lock = open('/run/lock/rhi-scheduled-upload.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    archive_lock = open('/run/lock/rhi-database-backup.lock', 'a')
    fcntl.flock(archive_lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
    spec = importlib.util.spec_from_file_location('policy', ROOT / 'scheduled-backup-policy.py')
    policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(policy)
    settings = json.loads((ROOT / 'scheduled-backup-settings.json').read_text())
    daily, weekly = settings['retain_daily'], settings['retain_weekly']
    policy.retained_snapshots([], daily, weekly)
    assert isinstance(settings['full_read_weekday_utc'], int) and 0 <= settings['full_read_weekday_utc'] <= 6
    assert isinstance(settings['reserve_bytes'], int) and settings['reserve_bytes'] >= 1024**3
    ready = json.loads((ROOT / 'scheduled-backup-package.json').read_text())
    package = Path(ready['package']).resolve()
    stamp = package.name
    assert ready['ready_for_upload'] and ready['source'] == 'vps'
    assert package.parent == Path('/opt/rhi/backups/readable') and re.fullmatch(r'\d{8}T\d{6}Z', stamp)
    snapshot_time = datetime.datetime.strptime(stamp, '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc)
    assert 0 <= (datetime.datetime.now(datetime.timezone.utc) - snapshot_time).total_seconds() < 26 * 3600
    report = json.loads((package / 'Daftar Data.json').read_text())
    assert report['ready_for_upload'] and report['csv_verified'] and report['storage_files_verified']
    assert report['recovery']['all_restored_files_verified']
    config = ROOT / 'rclone.conf'
    password = ROOT / 'restic.password'
    for p in [config, password]:
        assert p.is_file() and not p.is_symlink() and p.stat().st_uid == 0 and p.stat().st_mode & 0o077 == 0
    env = {**os.environ, 'RCLONE_CONFIG': str(config), 'RESTIC_PASSWORD_FILE': str(password)}
    work = ROOT / ('scheduled-upload-' + stamp)
    work.mkdir(exist_ok=True, mode=0o700)
    tree = work / 'tree'
    tree.mkdir(exist_ok=True, mode=0o700)
    snapshot_relative = PREFIX + '/Snapshot/' + stamp
    snapshot = tree / snapshot_relative
    snapshot.mkdir(parents=True, exist_ok=True, mode=0o700)
    remote_snapshot = 'rhi_drive:' + snapshot_relative

    def run(command, name):
        with (work / name).open('w') as output:
            subprocess.run(command, env=env, stdout=output, stderr=subprocess.STDOUT, check=True)

    def capture(command):
        result = subprocess.run(command, env=env, capture_output=True)
        assert result.returncode == 0, 'Backup command failed; inspect private service logs'
        return result.stdout

    def remote_json(path):
        return json.loads(capture(['rclone', 'cat', 'rhi_drive:' + path]))

    target = json.loads((ROOT / 'google-drive-backup-target.json').read_text())
    run(['rclone', 'about', 'rhi_drive:', '--json'], 'quota-before.json')
    cp = configparser.ConfigParser(interpolation=None)
    cp.read(config)
    remote = cp['rhi_drive']
    assert remote['type'] == 'drive' and remote['scope'] == 'drive.file'
    assert remote['root_folder_id'] == target['app_folder_id']
    token = json.loads(remote['token'])['access_token']
    response = requests.get('https://www.googleapis.com/drive/v3/files/' + target['app_folder_id'],
        headers={'Authorization': 'Bearer ' + token}, params={
        'fields': 'id,parents,ownedByMe,trashed,capabilities(canAddChildren),permissions(type,role)'}, timeout=30)
    assert response.status_code == 200, 'Drive destination cannot be verified'
    folder = response.json()
    assert folder.get('parents') == [target['folder_id']] and folder.get('ownedByMe') and not folder.get('trashed')
    assert folder['capabilities']['canAddChildren'] and folder.get('permissions')
    assert all(p['type'] == 'user' and p['role'] == 'owner' for p in folder['permissions']), 'Backup folder must remain private'

    # Validate all immutable local inputs before generating a separate Drive layout.
    with (work / 'local-check.log').open('w') as output:
        subprocess.run(['sha256sum', '--quiet', '-c', 'SHA256SUMS'], cwd=package, env=env,
                       stdout=output, stderr=subprocess.STDOUT, check=True)
    baseline_package = Path('/opt/rhi/backups/readable') / BASELINE
    baseline = json.loads((baseline_package / 'Daftar Foto dan Dokumen.json').read_text())
    old_photos = {p['id']: p for p in baseline}
    assert len(old_photos) == len(baseline)
    photos = json.loads((package / 'Daftar Foto dan Dokumen.json').read_text())

    def link(source, relative):
        policy.relative_path(relative)
        dest = tree / relative
        assert source.is_file() and not source.is_symlink() and not dest.is_symlink()
        dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if dest.exists():
            assert digest(source) == digest(dest), 'Never replace immutable staged data'
        else:
            os.link(source, dest)

    for path in package.rglob('*'):
        assert not path.is_symlink()
        if not path.is_file():
            continue
        rel = str(path.relative_to(package))
        if rel.startswith('Foto & Dokumen/') or rel in ('SHA256SUMS', 'Daftar Foto dan Dokumen.json', 'BACA DULU.txt'):
            continue
        if rel.startswith('Backup Pemulihan/restic/locks/'):
            continue
        link(path, snapshot_relative + '/' + rel)
    reused = 0
    for photo in photos:
        prior = old_photos.get(photo['id'])
        if prior and all(prior[k] == photo[k] for k in ('version', 'bytes', 'sha256')):
            path = 'Backup-' + BASELINE + '/Foto & Dokumen/' + prior['file']
            reused += 1
        else:
            assert re.fullmatch(r'[0-9a-f-]{36}', photo['id']) and re.fullmatch(r'[0-9a-f]{64}', photo['sha256'])
            path = PREFIX + '/Foto & Dokumen/' + photo['id'] + '/' + photo['sha256'] + '/' + Path(photo['file']).name
        photo['drive_path'] = policy.relative_path(path)
        link(package / 'Foto & Dokumen' / policy.relative_path(photo['file']), path)
    write_json(snapshot / 'Daftar Foto dan Dokumen.json', photos)
    (snapshot / 'BACA DULU.txt').write_text((package / 'BACA DULU.txt').read_text() +
        '\nBACKUP OTOMATIS\nFoto tidak digandakan pada setiap tanggal. Kolom drive_path dalam\n'
        'Daftar Foto dan Dokumen.json menunjukkan lokasi file relatif terhadap folder RHI VPS Backup.\n'
        'Backup awal dipertahankan karena dipakai bersama. Jangan memindahkan atau menghapus foto\n'
        'secara manual. Retensi snapshot: ' + str(daily) + ' harian dan ' + str(weekly) + ' mingguan.\n'
        'Snapshot otomatis lama di luar retensi dihapus hanya setelah snapshot baru terverifikasi.\n')
    snapshot_files = {str(p.relative_to(snapshot)): digest(p) for p in snapshot.rglob('*') if p.is_file() and p.name != 'SHA256SUMS'}
    (snapshot / 'SHA256SUMS').write_text(''.join(sha + '  ' + name + '\n' for name, sha in sorted(snapshot_files.items())))
    local = {str(p.relative_to(tree)): p for p in tree.rglob('*') if p.is_file()}
    run(['rclone', 'lsjson', 'rhi_drive:', '--recursive', '--files-only', '--hash', '--fast-list'], 'remote-before.json')
    inventory = json.loads((work / 'remote-before.json').read_text())
    names = [v['Path'] for v in inventory]
    assert len(names) == len(set(names)), 'Duplicate Drive paths need review'
    before = {v['Path']: v for v in inventory}
    missing = []
    for name, path in local.items():
        if name in before:
            item = before[name]
            assert item['Size'] == path.stat().st_size and item.get('Hashes', {}).get('md5') == digest(path, 'md5'), 'Existing backup differs'
        else:
            # The legacy backup is pinned and was fully verified; missing photos
            # are an incident, never silently repaired from potentially newer data.
            assert not name.startswith('Backup-' + BASELINE + '/'), 'Pinned baseline file is missing'
            missing.append(name)
    new_bytes = sum(local[name].stat().st_size for name in missing)
    quota = json.loads((work / 'quota-before.json').read_text())
    assert quota.get('free', 0) > new_bytes + settings['reserve_bytes'], 'Drive quota below reserve; no retention or deletion attempted'
    (work / 'new-files.txt').write_text(''.join(name + '\n' for name in sorted(missing)))
    # Include files uploaded during an interrupted prior attempt. Existence at
    # the start of this retry is not proof that a previous download check passed.
    download_candidates = [name for name in local if not name.startswith('Backup-' + BASELINE + '/')]
    (work / 'download-files.txt').write_text(''.join(name + '\n' for name in sorted(download_candidates)))
    print(json.dumps({'new_files': len(missing), 'new_bytes': new_bytes, 'baseline_photos_reused': reused}), flush=True)
    run(['rclone', 'copy', str(tree), 'rhi_drive:', '--immutable', '--checksum', '--fast-list', '--check-first',
         '--transfers', '8', '--checkers', '8', '--stats', '30s', '--stats-one-line'], 'upload.log')
    run(['rclone', 'check', str(tree), 'rhi_drive:', '--one-way', '--checksum', '--fast-list', '--checkers', '8'], 'checksum.log')
    # Read every new byte back, not just Drive's reported checksum. Reused photos
    # were already read back during the baseline verification; hash-check daily.
    if download_candidates:
        run(['rclone', 'check', str(tree), 'rhi_drive:', '--one-way', '--download', '--files-from-raw', str(work / 'download-files.txt'),
             '--fast-list', '--checkers', '8'], 'download-check.log')
    full_read = datetime.datetime.now(datetime.timezone.utc).weekday() == settings['full_read_weekday_utc']
    if full_read:
        run(['rclone', 'check', str(tree), 'rhi_drive:', '--one-way', '--download', '--fast-list', '--checkers', '8'], 'weekly-full-read.log')
    env['RESTIC_REPOSITORY'] = 'rclone:' + remote_snapshot + '/Backup Pemulihan/restic'
    run(['restic', 'check', '--read-data'], 'recovery-check.log')
    database = Path('/opt/rhi/backups/daily-database') / report['database_backup']
    restored = work / 'restored'
    run(['restic', 'restore', report['recovery']['snapshot_id'], '--target', str(restored), '--include', str(database)], 'recovery-restore.log')
    for path in database.iterdir():
        if path.is_file():
            assert digest(path) == digest(restored / path.relative_to('/')), 'Restored database/configuration checksum differs'
    assert (restored / (database / 'frontend.tar.gz').relative_to('/')).is_file()
    shutil.rmtree(restored)
    run(['rclone', 'lsjson', remote_snapshot, '--recursive', '--files-only', '--hash', '--fast-list'], 'remote-after.json')
    after = json.loads((work / 'remote-after.json').read_text())
    paths = [v['Path'] for v in after if v['Path'] != 'COMPLETE.json']
    assert len(paths) == len(set(paths)) and set(paths) == {str(p.relative_to(snapshot)) for p in snapshot.rglob('*') if p.is_file()}
    result = {'format': MAGIC, 'snapshot': stamp, 'source': 'vps', 'completed_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'remote_path': snapshot_relative, 'remote_checksums_verified': True, 'new_files_download_verified': True,
        'remote_full_read_this_run': full_read, 'database_configuration_frontend_restored': True,
        'remote_inventory_verified': True, 'storage_objects': len(photos), 'baseline_photos_reused': reused,
        'uploaded_new_bytes': new_bytes, 'retention_daily': daily, 'retention_weekly': weekly,
        'manifest_sha256': digest(snapshot / 'SHA256SUMS'), 'photo_index_sha256': digest(snapshot / 'Daftar Foto dan Dokumen.json')}
    # A repeat after a completed upload preserves the original immutable receipt.
    complete_path = snapshot_relative + '/COMPLETE.json'
    if complete_path in before:
        prior = remote_json(complete_path)
        assert prior['format'] == MAGIC and prior['snapshot'] == stamp and prior['manifest_sha256'] == result['manifest_sha256']
        result = prior
    else:
        write_json(work / 'COMPLETE.json', result)
        run(['rclone', 'copyto', str(work / 'COMPLETE.json'), 'rhi_drive:' + complete_path, '--immutable'], 'complete-upload.log')
        assert remote_json(complete_path) == result
    write_json(work / 'report.json', result)
    write_json(ROOT / 'scheduled-backup-latest.json', result)

    # Only our marked snapshots, never the pinned legacy backup or user files.
    completed = {stamp: result}
    for name in before:
        match = re.fullmatch(re.escape(PREFIX) + r'/Snapshot/(\d{8}T\d{6}Z)/COMPLETE.json', name)
        if match:
            item = remote_json(name)
            assert item['format'] == MAGIC and item['snapshot'] == match[1]
            assert item['remote_path'] == PREFIX + '/Snapshot/' + match[1]
            assert item['remote_checksums_verified'] and item['database_configuration_frontend_restored']
            completed[match[1]] = item
    keep = policy.retained_snapshots(completed, daily, weekly)
    assert stamp in keep, 'Never prune after uploading an older snapshot'
    obsolete = sorted(set(completed) - keep)
    write_json(work / 'retention-plan.json', {'keep': sorted(keep), 'remove': obsolete, 'baseline_pinned': BASELINE})
    for old in obsolete:
        # Locally signed-by-provenance receipts are required for automated removal.
        receipt = ROOT / ('scheduled-upload-' + old) / 'report.json'
        assert receipt.is_file() and json.loads(receipt.read_text()) == completed[old]
        saved_inventory = json.loads(receipt.with_name('remote-after.json').read_text())
        current_inventory = json.loads(capture(['rclone', 'lsjson', 'rhi_drive:' + PREFIX + '/Snapshot/' + old,
            '--recursive', '--files-only', '--hash', '--fast-list']))
        assert policy.inventory_signature(saved_inventory) == policy.inventory_signature(current_inventory), 'Changed or added files block automatic retention'
        run(['rclone', 'purge', 'rhi_drive:' + PREFIX + '/Snapshot/' + old, '--drive-use-trash=false'], 'retention-' + old + '.log')
        # Prune only local artifacts whose origin proves this scheduler created
        # them. Migration snapshots and the original readable backup stay pinned.
        local_snapshot = Path('/opt/rhi/backups') / ('delta-' + old)
        readable = Path('/opt/rhi/backups/readable') / old
        if local_snapshot.exists():
            assert not local_snapshot.is_symlink()
            origin = json.loads((local_snapshot / 'origin.json').read_text())
            assert origin['origin'] == 'vps-daily-database'
            assert origin['archive'] == '/opt/rhi/backups/daily-database/' + old
            if readable.exists():
                assert not readable.is_symlink()
                assert json.loads((readable / 'Daftar Data.json').read_text())['source_snapshot'] == 'delta-' + old
                shutil.rmtree(readable)
            shutil.rmtree(local_snapshot)
    # Shared photos remain pinned. Monitoring detects growth; pruning shared
    # blobs requires a separate reference audit and is deliberately not guessed.
    run(['rclone', 'about', 'rhi_drive:', '--json'], 'quota-after.json')
    write_json(ROOT / 'scheduled-backup-retention.json', {'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'retained_snapshots': sorted(keep), 'removed_snapshots': obsolete, 'shared_photos_pinned': True,
        'drive_free_bytes': json.loads((work / 'quota-after.json').read_text()).get('free'), 'baseline_pinned': BASELINE})
    # Staging links are disposable only after the complete remote recovery test.
    shutil.rmtree(tree)
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
