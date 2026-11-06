#!/usr/bin/env python3
"""Upload a verified readable backup package to the chosen private Drive.

Requires the user's OAuth authorization in a root-only rclone configuration.
Checks folder ownership, restricted sharing and available space before upload;
then checks remote content and restores actual data. Does not enable recurring
backup, change sharing, remove snapshots, or send the recovery password to Drive.
"""
import argparse
import configparser
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess

import requests


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package')
    args = parser.parse_args()
    assert os.geteuid() == 0 and socket.gethostname().split('.')[0] == 'srv2126686'
    os.umask(0o077)
    lock = open('/run/lock/rhi-readable-backup.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    root = Path('/opt/rhi/migration')
    config_path = root / 'rclone.conf'
    password = root / 'restic.password'
    for path in (config_path, password):
        assert path.is_file() and not path.is_symlink()
        assert path.stat().st_uid == 0 and path.stat().st_mode & 0o077 == 0, 'Credentials must be root-only'
    destination = json.loads((root / 'google-drive-backup-target.json').read_text())
    assert destination['folder_permissions_verified'] and destination['general_access'] == 'restricted'
    # drive.file can reach only app-created/selected files. A dedicated child
    # folder can be moved into the user's selected parent through Drive's UI.
    api_folder_id = destination.get('app_folder_id', destination['folder_id'])
    package = Path(args.package).resolve()
    assert package.parent == Path('/opt/rhi/backups/readable')
    local_report = json.loads((package / 'Daftar Data.json').read_text())
    assert local_report['csv_verified'] and local_report['storage_files_verified']
    assert local_report['ready_for_upload'] and local_report['index_verified']
    assert local_report['recovery']['full_read_verified'] and local_report['recovery']['all_restored_files_verified']
    assert (package / 'Data CSV/00_Daftar_Data.csv').is_file()
    assert (package / 'SHA256SUMS').is_file(), 'Final package checksums required'
    repository = package / 'Backup Pemulihan/restic'
    env = {**os.environ, 'RCLONE_CONFIG': str(config_path), 'RESTIC_PASSWORD_FILE': str(password)}
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    logs = root / ('drive-backup-' + stamp)
    logs.mkdir(mode=0o700)

    def run(command, name):
        with (logs / name).open('w') as output:
            subprocess.run(command, env=env, cwd=package, stdout=output, stderr=subprocess.STDOUT, check=True)

    def read_config():
        config = configparser.ConfigParser(interpolation=None)
        config.read(config_path)
        assert config.has_section('rhi_drive'), 'Dedicated rhi_drive remote required'
        remote = config['rhi_drive']
        assert remote['type'] == 'drive'
        assert remote['root_folder_id'] == api_folder_id, 'Wrong backup folder'
        assert remote.get('scope') == 'drive.file', 'Only per-file backup access is allowed'
        assert remote.get('client_id') and remote.get('client_secret'), 'Dedicated OAuth client required'
        return remote

    read_config()
    run(['sha256sum', '--quiet', '-c', str(package / 'SHA256SUMS')], 'local-check.log')
    # This also refreshes OAuth through rclone when needed. Never print tokens.
    run(['rclone', 'about', 'rhi_drive:', '--json'], 'quota.json')

    def check_folder():
        remote = read_config()
        token = json.loads(remote['token'])['access_token']
        response = requests.get('https://www.googleapis.com/drive/v3/files/' + api_folder_id,
            headers={'Authorization': 'Bearer ' + token}, params={
                'fields': 'id,parents,mimeType,ownedByMe,trashed,capabilities(canAddChildren),permissions(type,role)'}, timeout=30)
        assert response.status_code == 200, 'Cannot verify destination folder'
        folder = response.json()
        assert folder['id'] == api_folder_id and folder['mimeType'] == 'application/vnd.google-apps.folder'
        if api_folder_id != destination['folder_id']:
            assert folder.get('parents') == [destination['folder_id']], 'Backup folder must be inside the selected destination'
        assert folder.get('ownedByMe') and not folder.get('trashed') and folder['capabilities']['canAddChildren']
        assert folder.get('permissions') and all(p['type'] == 'user' and p['role'] == 'owner'
            for p in folder['permissions']), 'Destination must be private to the owner'

    check_folder()
    quota = json.loads((logs / 'quota.json').read_text())
    size = sum(p.stat().st_size for p in package.rglob('*') if p.is_file())
    assert quota.get('free', 0) > size + 1024 ** 3, 'Insufficient free Drive quota plus safety margin'
    remote_path = 'rhi_drive:Backup-' + package.name
    excluded = '/Backup Pemulihan/restic/locks/**'
    print('Verified private destination and quota; uploading readable backup package', flush=True)
    run(['rclone', 'copy', str(package), remote_path, '--immutable', '--exclude', excluded,
         '--transfers', '3', '--checkers', '4', '--stats', '30s', '--stats-one-line'], 'upload.log')
    run(['rclone', 'check', str(package), remote_path, '--one-way', '--download', '--exclude', excluded], 'checksum.log')
    env['RESTIC_REPOSITORY'] = 'rclone:' + remote_path + '/Backup Pemulihan/restic'
    print('Upload complete; reading back encrypted data from Drive', flush=True)
    run(['restic', 'check', '--read-data'], 'remote-check.log')
    database = Path('/opt/rhi/backups/daily-database') / local_report['database_backup']
    files = [database / 'postgres.dump', database / 'configuration.tar.gz']
    restored = logs / 'restored'
    command = ['restic', 'restore', local_report['recovery']['snapshot_id'], '--target', str(restored)]
    for path in files:
        command.extend(['--include', str(path)])
    run(command, 'remote-restore.log')
    for original in files:
        assert digest(original) == digest(restored / original.relative_to('/')), 'Drive restore checksum mismatch'
    check_folder()
    report = {'completed_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'folder_id': destination['folder_id'], 'app_folder_id': api_folder_id,
              'snapshot_id': local_report['recovery']['snapshot_id'],
              'package_bytes': size, 'remote_full_read_verified': True,
              'database_and_configuration_restored': True, 'all_csv_and_storage_download_checked': True,
              'folder_owner_only': True,
              'offsite_uploaded': True, 'recurring_offsite_backup_enabled': False}
    (logs / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    shutil.rmtree(restored)  # Only this invocation's disposable, verified restore.
    print('Drive backup and restore verified; private receipt:', logs / 'report.json', flush=True)


if __name__ == '__main__':
    main()
