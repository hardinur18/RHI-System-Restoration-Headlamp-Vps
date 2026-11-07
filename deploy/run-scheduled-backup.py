#!/usr/bin/env python3
"""Run and record the daily off-site pipeline. Never enables itself or cutover."""
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import socket
import subprocess

assert os.geteuid() == 0 and socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
root = Path('/opt/rhi/migration')
lock = open('/run/lock/rhi-scheduled-backup.lock', 'w')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
status = {'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'state': 'running'}


def record():
    status['updated_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    temporary = root / 'scheduled-backup-status.pending.json'
    temporary.write_text(json.dumps(status, indent=2))
    temporary.replace(root / 'scheduled-backup-status.json')


try:
    status['step'] = 'ensure_recent_database_archive'
    record()
    archives = sorted(p for p in Path('/opt/rhi/backups/daily-database').iterdir()
        if re.fullmatch(r'\d{8}T\d{6}Z', p.name) and (p / 'SHA256SUMS').is_file())
    now = datetime.datetime.now(datetime.timezone.utc)
    age = (now - datetime.datetime.strptime(archives[-1].name, '%Y%m%dT%H%M%SZ')
        .replace(tzinfo=datetime.timezone.utc)).total_seconds() if archives else float('inf')
    # On boot a missed persistent timer can run before today's local archive.
    # Join the existing oneshot if active, or create a fresh archive if needed.
    if not 0 <= age < 2 * 3600:
        subprocess.run(['systemctl', 'start', 'rhi-database-backup.service'], check=True)
    for step in ['prepare-scheduled-backup.py', 'upload-scheduled-backup.py']:
        status['step'] = step
        record()
        subprocess.run(['python3', str(root / step)], check=True)
    status['state'] = 'complete'
    status['snapshot'] = json.loads((root / 'scheduled-backup-latest.json').read_text())['snapshot']
    record()
except BaseException as error:
    status['state'] = 'failed'
    status['error_type'] = type(error).__name__
    record()
    raise
