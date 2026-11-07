#!/usr/bin/env python3
"""Enable timers only after a verified offsite run and durable OAuth consent."""
import datetime
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess

assert os.geteuid() == 0 and socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
root = Path('/opt/rhi/migration')
auth = json.loads((root / 'google-drive-production-authorization.json').read_text())
assert auth['production_reauthorized'] and auth['scope'] == 'drive.file'
assert auth['project_id'] == 'modified-legacy-513908-b4'
latest = json.loads((root / 'scheduled-backup-latest.json').read_text())
assert latest['remote_checksums_verified'] and latest['new_files_download_verified']
assert latest['database_configuration_frontend_restored'] and latest['remote_inventory_verified']
age = (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(latest['completed_utc'])).total_seconds()
assert 0 <= age < 26 * 3600, 'A fresh verified upload is required'
units = ['rhi-offsite-backup.service', 'rhi-offsite-backup.timer', 'rhi-backup-health.service', 'rhi-backup-health.timer']
subprocess.run(['systemd-analyze', 'verify', *[str(root / u) for u in units]], check=True)
for unit in units:
    shutil.copyfile(root / unit, Path('/etc/systemd/system') / unit)
    os.chmod(Path('/etc/systemd/system') / unit, 0o644)
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'enable', '--now', 'rhi-offsite-backup.timer', 'rhi-backup-health.timer'], check=True)
subprocess.run(['python3', str(root / 'check-scheduled-backup.py')], check=True)
print('Daily offsite and hourly local-health timers enabled and checked')
