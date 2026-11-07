#!/usr/bin/env python3
"""Run and record the daily off-site pipeline. Never enables itself or cutover."""
import datetime
import fcntl
import json
import os
from pathlib import Path
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
