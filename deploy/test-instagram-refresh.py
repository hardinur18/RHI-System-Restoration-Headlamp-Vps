#!/usr/bin/env python3
"""Provider/runtime failure tests; no actual credentials, database or Docker."""
import contextlib
import datetime as dt
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('refresh', Path(__file__).with_name('refresh-instagram-vps.py'))
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)


class Database:
    def __init__(self, state):
        self.state, self.writes = state, 0

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def cursor(self):
        return self

    def execute(self, query, params):
        if query.startswith('insert'):
            self.state = params[1].adapted
            self.writes += 1
        else:
            assert query.startswith('select key,value')

    def fetchall(self):
        return [('meta:instagram:token:rhi-system', self.state)]

    def close(self):
        pass


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.lock = tempfile.TemporaryFile('w')
        self.addCleanup(self.lock.close)
        self.env = self.root / 'runtime.env'
        self.env.write_text('UNRELATED_SETTING=preserved\nMETA_IG_ACCESS_TOKEN=old-token\nMETA_IG_ACCOUNT_ID=account-1\n')
        self.db = Database({'accessToken': 'old-token', 'accountId': 'account-1',
                            'expiresAt': (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=2)).isoformat()})
        self.calls = []

    def provider(self, url, **kwargs):
        self.calls.append(url)
        assert url.startswith('https://graph.instagram.com/')
        assert kwargs['allow_redirects'] is False
        if url.endswith('/refresh_access_token'):
            body = {'access_token': 'new-token', 'expires_in': 60 * 86400}
        elif url.endswith('/me'):
            body = {'id': 'account-1', 'user_id': 'user-1', 'username': 'fixture', 'account_type': 'BUSINESS'}
        else:
            assert url.endswith('/conversations')
            body = {'data': []}
        return SimpleNamespace(ok=True, status_code=200, json=lambda: body)

    def run_refresh(self, provider=None, reload_error=None):
        fake_spec = SimpleNamespace(loader=SimpleNamespace(exec_module=lambda module: None))
        fake_delta = SimpleNamespace(connection_target=lambda **kwargs: self.db)
        output = io.StringIO()
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(refresh.socket, 'gethostname', return_value='srv2126686'))
            stack.enter_context(patch.object(refresh.os, 'geteuid', return_value=0))
            stack.enter_context(patch.object(refresh, 'Path', side_effect=lambda p: Path(str(p).replace('/opt/rhi/migration', str(self.root)))))
            stack.enter_context(patch.object(refresh, 'open', return_value=self.lock, create=True))
            stack.enter_context(patch.object(refresh.importlib.util, 'spec_from_file_location', return_value=fake_spec))
            stack.enter_context(patch.object(refresh.importlib.util, 'module_from_spec', return_value=fake_delta))
            stack.enter_context(patch.object(refresh.requests, 'get', side_effect=provider or self.provider))
            reload = stack.enter_context(patch.object(refresh.subprocess, 'run', side_effect=reload_error))
            stack.enter_context(patch('sys.argv', ['refresh-instagram-vps.py']))
            stack.enter_context(contextlib.redirect_stdout(output))
            refresh.main()
        text = output.getvalue()
        self.assertNotIn('new-token', text)
        self.assertNotIn('old-token', text)
        return json.loads(text), reload

    def test_refresh_updates_only_vps_state_and_worker(self):
        report, reload = self.run_refresh()
        self.assertTrue(report['refreshed'] and report['runtime_reloaded'])
        self.assertEqual(self.db.writes, 1)
        self.assertEqual(len(self.calls), 3)
        self.assertIn('META_IG_ACCESS_TOKEN=new-token', self.env.read_text())
        self.assertIn('UNRELATED_SETTING=preserved', self.env.read_text())
        self.assertEqual(reload.call_args.args[0][-4:], ['up', '-d', '--no-deps', 'functions'])

    def test_rejected_rotation_preserves_credentials(self):
        before = self.env.read_bytes()
        denied = lambda *a, **k: SimpleNamespace(ok=False, status_code=401, json=lambda: {'error': {}})
        with self.assertRaisesRegex(RuntimeError, 'HTTP 401'):
            self.run_refresh(provider=denied)
        self.assertEqual(self.env.read_bytes(), before)
        self.assertEqual(self.db.writes, 0)

    def test_failed_reload_retries_without_rotating_again(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_refresh(reload_error=subprocess.CalledProcessError(1, ['docker']))
        self.assertTrue((self.root / 'instagram-runtime-reload.pending').exists())
        self.calls.clear()
        report, reload = self.run_refresh()
        self.assertFalse(report['refreshed'])
        self.assertTrue(report['runtime_reloaded'])
        self.assertEqual(self.calls, [])
        self.assertFalse((self.root / 'instagram-runtime-reload.pending').exists())
        self.assertEqual(self.db.writes, 1)


if __name__ == '__main__':
    unittest.main()
