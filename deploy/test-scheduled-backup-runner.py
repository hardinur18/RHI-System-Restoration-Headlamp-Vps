#!/usr/bin/env python3
"""Check boot catch-up and failure propagation without contacting a server."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name('run-scheduled-backup.py').read_text()


class RunnerTests(unittest.TestCase):
    def run_case(self, archive_age=None, fail_step=None, expired=False):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root, backups = base / 'migration', base / 'archives'
            root.mkdir(); backups.mkdir()
            (root / 'backup-authorization.py').write_text(Path(__file__).with_name('backup-authorization.py').read_text())
            (root / 'google-drive-production-authorization.json').write_text(json.dumps({
                'production_reauthorized': True, 'scope': 'drive.file', 'project_id': 'modified-legacy-513908-b4'}))
            if expired:
                (root / 'google-drive-production-authorization.json').unlink()
                issued = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=8)
                (root / 'google-drive-testing-authorization.json').write_text(json.dumps({
                    'owner_accepted_seven_day_limit': True, 'scope': 'drive.file', 'project_id': 'modified-legacy-513908-b4',
                    'received_at': issued.isoformat(), 'expires_at': (issued + datetime.timedelta(days=7)).isoformat()}))
            if archive_age is not None:
                stamp = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=archive_age)).strftime('%Y%m%dT%H%M%SZ')
                archive = backups / stamp
                archive.mkdir()
                (archive / 'SHA256SUMS').write_text('fixture')
            (root / 'scheduled-backup-latest.json').write_text(json.dumps({'snapshot': 'fixture-snapshot'}))
            source = SOURCE.replace('/opt/rhi/migration', str(root)).replace('/opt/rhi/backups/daily-database', str(backups))
            source = source.replace('/run/lock/rhi-scheduled-backup.lock', str(base / 'run.lock'))
            calls = []
            def run(command, **kwargs):
                step = 'database' if command[0] == 'systemctl' else Path(command[1]).name
                calls.append(step)
                if step == fail_step: raise subprocess.CalledProcessError(1, command)
                return subprocess.CompletedProcess(command, 0)
            namespace = {}
            previous_umask = os.umask(0o077)
            try:
                with patch('socket.gethostname', return_value='srv2126686'), patch('os.geteuid', return_value=0), patch('subprocess.run', side_effect=run):
                    if expired:
                        with self.assertRaises(AssertionError): exec(compile(source, 'runner-under-test', 'exec'), namespace)
                    elif fail_step:
                        with self.assertRaises(subprocess.CalledProcessError): exec(compile(source, 'runner-under-test', 'exec'), namespace)
                    else:
                        exec(compile(source, 'runner-under-test', 'exec'), namespace)
                status = json.loads((root / 'scheduled-backup-status.json').read_text())
            finally:
                if 'lock' in namespace: namespace['lock'].close()
                os.umask(previous_umask)
            return calls, status

    def test_recent_archive_is_reused(self):
        calls, status = self.run_case(archive_age=0.25)
        self.assertEqual(calls, ['prepare-scheduled-backup.py', 'upload-scheduled-backup.py'])
        self.assertEqual(status['state'], 'complete')

    def test_expired_testing_grant_stops_before_any_backup_or_upload(self):
        calls, status = self.run_case(expired=True)
        self.assertEqual(calls, [])
        self.assertEqual(status['state'], 'failed')
        self.assertEqual(status['step'], 'verify_drive_authorization')

    def test_missed_timer_catches_up_before_export(self):
        for age in [None, 3, -1]:
            calls, status = self.run_case(archive_age=age)
            self.assertEqual(calls, ['database', 'prepare-scheduled-backup.py', 'upload-scheduled-backup.py'])
            self.assertEqual(status['state'], 'complete')

    def test_database_failure_does_not_upload_an_old_archive(self):
        calls, status = self.run_case(archive_age=30, fail_step='database')
        self.assertEqual(calls, ['database'])
        self.assertEqual(status['state'], 'failed')

    def test_preparation_failure_never_calls_upload(self):
        calls, status = self.run_case(archive_age=0.25, fail_step='prepare-scheduled-backup.py')
        self.assertEqual(calls, ['prepare-scheduled-backup.py'])
        self.assertEqual(status['state'], 'failed')


if __name__ == '__main__':
    unittest.main()
