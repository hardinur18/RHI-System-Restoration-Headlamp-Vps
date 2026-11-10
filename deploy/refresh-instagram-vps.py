#!/usr/bin/env python3
"""Continue the source Instagram refresh schedule on the dedicated VPS.

Uses the migrated KV state and updates the local worker environment, never Cloud
secrets. Provider URLs and response fields match scripts/meta-ig-refresh.mjs.
No messages are sent. --check-only inspects expiry without rotating credentials.
"""
import argparse
import datetime as dt
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess

import requests
from psycopg2.extras import Json


def expiry_of(state, env):
    value = state.get('expiresAt') or state.get('tokenExpiresAt') or env.get('META_IG_TOKEN_EXPIRES_AT')
    if not value:
        return None
    try:
        expiry = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        return expiry if expiry.tzinfo else None
    except ValueError:
        return None


def main():
    assert socket.gethostname().split('.')[0] == 'srv2126686' and os.geteuid() == 0
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    lock = open('/run/lock/rhi-instagram-refresh.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    root = Path('/opt/rhi/migration')
    spec = importlib.util.spec_from_file_location('delta', root / 'plan-delta.py')
    delta = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(delta)
    env_file = root / 'runtime.env'
    original = env_file.read_text()
    env = dict(line.split('=', 1) for line in original.splitlines() if '=' in line and not line.startswith('#'))
    key = 'meta:instagram:token:rhi-system'
    db = delta.connection_target(admin=True)
    try:
        with db, db.cursor() as cur:
            cur.execute('select key,value from public.kv_store_f781cd00 where key=any(%s)',
                        ([key, 'meta:instagram:token:polesheadlamp.id'],))
            states = dict(cur.fetchall())
        state = states.get(key) or states.get('meta:instagram:token:polesheadlamp.id') or {}
        token = state.get('accessToken') or state.get('token') or env.get('META_IG_ACCESS_TOKEN')
        assert token, 'Instagram credential missing'
        now = dt.datetime.now(dt.timezone.utc)
        expiry = expiry_of(state, env)
        refresh = not expiry or expiry <= now + dt.timedelta(days=21)
        report = {'checked_at': now.isoformat(), 'expires_at': expiry.isoformat() if expiry else None,
                  'refresh_due': refresh, 'check_only': args.check_only, 'refreshed': False, 'runtime_reloaded': False}
        if args.check_only:
            print(json.dumps(report))
            return

        def api(path, params):
            # Do not include a credential-bearing request URL in exception logs.
            try:
                response = requests.get('https://graph.instagram.com/' + path, params=params,
                                        timeout=45, allow_redirects=False)
                body = response.json()
            except Exception:
                raise RuntimeError('Instagram request failed') from None
            if not response.ok or body.get('error'):
                raise RuntimeError('Instagram API rejected request (HTTP ' + str(response.status_code) + ')')
            return body

        if refresh:
            result = api('refresh_access_token', {'grant_type': 'ig_refresh_token', 'access_token': token})
            token = result.get('access_token')
            seconds = int(result.get('expires_in') or 0)
            assert token and seconds > 86400, 'Invalid refresh response'
            profile = api('v25.0/me', {'fields': 'id,user_id,username,account_type', 'access_token': token})
            conversations = api('v25.0/me/conversations',
                                {'fields': 'id,updated_time', 'limit': 3, 'access_token': token})
            previous_account = state.get('accountId') or env.get('META_IG_ACCOUNT_ID')
            assert str(profile['id']) == str(previous_account), 'Instagram account changed'
            expiry = now + dt.timedelta(seconds=seconds)
            state = {**state, 'token': token, 'accessToken': token, 'userId': profile['user_id'],
                     'accountId': profile['id'], 'username': profile['username'], 'accountType': profile['account_type'],
                     'refreshedAt': now.isoformat(), 'expiresAt': expiry.isoformat(), 'expiresIn': seconds,
                     'conversationCount': len(conversations.get('data', [])), 'updatedAt': now.isoformat()}
            with db, db.cursor() as cur:
                cur.execute('insert into public.kv_store_f781cd00(key,value) values (%s,%s) '
                            'on conflict(key) do update set value=excluded.value', (key, Json(state)))
            report.update(refreshed=True, expires_at=expiry.isoformat())

        updates = {'META_IG_ACCESS_TOKEN': token}
        for field, suffix in [('userId', 'USER_ID'), ('accountId', 'ACCOUNT_ID'), ('username', 'USERNAME'),
                              ('accountType', 'ACCOUNT_TYPE'), ('scopes', 'SCOPES'),
                              ('refreshedAt', 'TOKEN_REFRESHED_AT'), ('expiresAt', 'TOKEN_EXPIRES_AT'),
                              ('expiresIn', 'TOKEN_EXPIRES_IN')]:
            if state.get(field) is not None:
                updates['META_IG_' + suffix] = str(state[field])
        assert all('\n' not in value and '\r' not in value for value in updates.values())
        needs_reload = any(env.get(k) != v for k, v in updates.items()) or (root / 'instagram-runtime-reload.pending').exists()
        if needs_reload:
            lines = [line for line in original.splitlines() if line.partition('=')[0] not in updates]
            pending = root / 'instagram-runtime-reload.pending'
            pending.write_text(now.isoformat())
            temporary = root / 'runtime.env.instagram-pending'
            temporary.write_text('\n'.join(lines + [k + '=' + v for k, v in updates.items()]) + '\n')
            temporary.replace(env_file)
            command = ['docker', 'compose', '-p', 'supabase', '--env-file', '.env']
            for file in ['docker-compose.yml', 'compose.staging.yml', 'compose.production.yml', 'compose.scheduler.yml']:
                command += ['-f', file]
            command += ['--profile', 'functions-ready', 'up', '-d', '--no-deps', 'functions']
            subprocess.run(command, cwd='/opt/rhi/supabase', check=True, capture_output=True)
            pending.unlink()
            report['runtime_reloaded'] = True
        (root / 'instagram-refresh-status.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report))
    finally:
        db.close()


if __name__ == '__main__':
    main()
