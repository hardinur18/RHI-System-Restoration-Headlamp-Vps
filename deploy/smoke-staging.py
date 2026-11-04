#!/usr/bin/env python3
"""Bounded target-only Auth/API checks with disposable, confirmed accounts.

--keep-fixtures preserves generated accounts in a mode-600 file for browser
checks. --cleanup removes only IDs from that exact fixture file.
"""
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import uuid
import requests

assert socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
root = Path('/opt/rhi/migration')
env = dict(line.split('=', 1) for line in Path('/opt/rhi/supabase/.env').read_text().splitlines()
           if '=' in line and not line.startswith('#'))
resolve = socket.getaddrinfo
socket.getaddrinfo = lambda host, *args, **kwargs: resolve(
    '127.0.0.1' if host == 'api-rhi.polesheadlamp.id' else host, *args, **kwargs)
base = 'https://api-rhi.polesheadlamp.id'
api = '/functions/v1/make-server-f781cd00'
admin = {'apikey': env['SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + env['SERVICE_ROLE_KEY']}
anon = {'apikey': env['ANON_KEY'], 'Authorization': 'Bearer ' + env['ANON_KEY']}
fixture_path = root / 'smoke-fixtures.json'
fixtures = []
results = []

def call(method, path, headers=None, **kwargs):
    return requests.request(method, base + path, headers=headers or anon, timeout=90, **kwargs)

def cleanup():
    for account in fixtures:
        assert account['email'].startswith('rhi-migration-') and account['email'].endswith('@example.invalid')
        user_id = str(uuid.UUID(account['id']))
        response = call('DELETE', '/rest/v1/profiles?id=eq.' + user_id, admin)
        assert response.ok
        response = call('DELETE', '/auth/v1/admin/users/' + user_id, admin)
        assert response.ok or response.status_code == 404
    fixture_path.unlink(missing_ok=True)

if '--cleanup' in sys.argv:
    fixtures = json.loads(fixture_path.read_text())
    cleanup()
    print('Temporary smoke accounts removed:', len(fixtures))
    sys.exit(0)

assert not fixture_path.exists(), 'Clean up previous fixtures first'
try:
    for path in ('/auth/v1/health', api + '/health'):
        response = call('GET', path)
        assert response.status_code == 200, (path, response.status_code)
        results.append({'check': path, 'status': response.status_code})
    response = call('GET', api + '/permissions/me')
    assert response.status_code == 401, 'Anonymous user must not receive account permissions'
    response = call('GET', '/rest/v1/orders?select=id&limit=1')
    assert response.status_code in (401, 403), 'Anonymous direct order access must remain denied'
    for role in ('Owner', 'Super Admin', 'Admin PIC', 'CS', 'Teknisi', 'Finance', 'Advertiser'):
        email = 'rhi-migration-' + uuid.uuid4().hex + '@example.invalid'
        password = secrets.token_urlsafe(36)
        response = call('POST', '/auth/v1/admin/users', admin, json={
            'email': email, 'password': password, 'email_confirm': True,
            'user_metadata': {'name': 'Migration check ' + role, 'role': role}})
        assert response.ok, ('create fixture', role, response.status_code)
        user = response.json().get('user') or response.json()
        account = {'id': user['id'], 'role': role, 'email': email, 'password': password}
        fixtures.append(account)
        fixture_path.write_text(json.dumps(fixtures))
        response = call('POST', '/rest/v1/profiles', {**admin, 'Prefer': 'resolution=merge-duplicates'}, json={
            'id': user['id'], 'email': email, 'name': 'Migration check ' + role, 'role': role,
            'status': 'active', 'branch_id': None, 'employment_status': 'permanent'})
        assert response.ok, ('profile', role, response.status_code)
        response = call('POST', '/auth/v1/token?grant_type=password', json={'email': email, 'password': password})
        assert response.ok, ('login', role, response.status_code)
        token = response.json()['access_token']
        headers = {**anon, 'Authorization': 'Bearer ' + token, 'x-client-token': token,
                   'Origin': 'https://rhi.polesheadlamp.id'}
        response = call('GET', api + '/permissions/me', headers)
        assert response.status_code == 200, ('permissions', role, response.status_code)
        assert response.headers.get('Access-Control-Allow-Origin') == 'https://rhi.polesheadlamp.id'
        access = response.json()['data']
        assert access['role'].lower() == role.lower(), ('role mismatch', role)
        assert access['isOwner'] == (role == 'Owner'), ('owner escalation', role)
        results.append({'role': role, 'login': True, 'permissions': True,
                        'effective_permission_count': len(access['effectivePermissions']), 'cors': True})
        print('PASS login, role, permissions, CORS:', role, flush=True)
    (root / 'auth-api-smoke.json').write_text(json.dumps(results, indent=2))
finally:
    if '--keep-fixtures' not in sys.argv or sys.exc_info()[0] is not None:
        cleanup()
