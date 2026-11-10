#!/usr/bin/env python3
import datetime
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('auth', Path(__file__).with_name('backup-authorization.py'))
auth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auth)
now = datetime.datetime.now(datetime.timezone.utc)


class AuthorizationTests(unittest.TestCase):
    def check_auth(self, age=3, accepted=True, duration=7):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            issued = now - datetime.timedelta(days=age)
            (root / 'google-drive-testing-authorization.json').write_text(json.dumps({
                'owner_accepted_seven_day_limit': accepted, 'scope': 'drive.file',
                'project_id': 'modified-legacy-513908-b4', 'received_at': issued.isoformat(),
                'expires_at': (issued + datetime.timedelta(days=duration)).isoformat()}))
            return auth.authorization_status(root, now)

    def test_testing_is_valid_but_never_durable(self):
        status = self.check_auth()
        self.assertTrue(status['valid'])
        self.assertFalse(status['durable'])
        self.assertEqual(status['hours_remaining'], 96)

    def test_expired_and_future_grants_fail_closed(self):
        for age in [7, 8, -1]:
            self.assertFalse(self.check_auth(age=age)['valid'])

    def test_no_implicit_acceptance_or_duration_extension(self):
        for options in [{'accepted': False}, {'duration': 8}]:
            with self.assertRaises(AssertionError): self.check_auth(**options)

    def test_missing_evidence_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertFalse(auth.authorization_status(Path(directory), now)['valid'])


if __name__ == '__main__':
    unittest.main()
