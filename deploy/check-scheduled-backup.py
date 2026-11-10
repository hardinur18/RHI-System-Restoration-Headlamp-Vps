#!/usr/bin/env python3
"""Local backup-health receipt; nonzero status is visible in systemd/journal."""
import datetime
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess

assert os.geteuid() == 0 and socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
root = Path('/opt/rhi/migration')
now = datetime.datetime.now(datetime.timezone.utc)
def read(name):
    path = root / name
    return json.loads(path.read_text()) if path.exists() else {}

latest = read('scheduled-backup-latest.json')
state = read('scheduled-backup-status.json')
spec = importlib.util.spec_from_file_location('backup_auth', root / 'backup-authorization.py')
backup_auth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup_auth)
auth = backup_auth.authorization_status(root, now)
retention = read('scheduled-backup-retention.json')
settings = read('scheduled-backup-settings.json')
age = (now - datetime.datetime.fromisoformat(latest['completed_utc'])).total_seconds() / 3600 if latest else None
active = subprocess.run(['systemctl', 'is-active', 'rhi-offsite-backup.timer'], capture_output=True, text=True).stdout.strip() == 'active'
problems = []
if not active: problems.append('offsite_timer_inactive')
if not auth['valid']: problems.append('oauth_missing_or_expired')
elif not auth['durable'] and auth['hours_remaining'] <= 24: problems.append('oauth_renewal_due_within_24_hours')
if age is None or not 0 <= age < 26: problems.append('offsite_backup_missing_or_stale')
if state.get('state') == 'failed': problems.append('latest_run_failed')
if retention.get('drive_free_bytes', 0) < settings.get('reserve_bytes', 2147483648): problems.append('drive_low_space')
report = {'checked_at': now.isoformat(), 'healthy': not problems, 'problems': problems,
    'latest_snapshot': latest.get('snapshot'), 'offsite_age_hours': round(age, 2) if age is not None else None,
    'timer_active': active, 'durable_oauth_confirmed': auth['durable'], 'oauth': auth,
    'drive_free_bytes': retention.get('drive_free_bytes'), 'notification_channel': 'local_systemd_journal_only'}
(root / 'scheduled-backup-health.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report))
raise SystemExit(0 if report['healthy'] else 1)
