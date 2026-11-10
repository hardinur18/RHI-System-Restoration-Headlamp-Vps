#!/usr/bin/env python3
"""Enable timers after a verified upload and an explicitly accepted OAuth mode."""
import datetime
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess

assert os.geteuid() == 0 and socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
root = Path('/opt/rhi/migration')
spec = importlib.util.spec_from_file_location('backup_auth', root / 'backup-authorization.py')
backup_auth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup_auth)
auth = backup_auth.authorization_status(root, datetime.datetime.now(datetime.timezone.utc))
assert auth['valid'], 'Valid, operator-observed Google authorization is required'
assert auth['durable'] or auth['hours_remaining'] > 24, 'Renew Testing consent before enabling timers'
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
