#!/usr/bin/env python3
"""Verify preview Auth/read access and database-enforced write rejection.

Prepare and verify while the fence remains installed. Profile preparation and
cleanup use the migration administrator, deliberately exempt from the fence.
"""
import argparse
import base64
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket
import uuid

import requests

parser = argparse.ArgumentParser()
parser.add_argument('action', choices=['prepare', 'check', 'cleanup'])
args = parser.parse_args()
assert socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
root = Path('/opt/rhi/migration')
fixture = root / 'preview-fixture.json'
env = dict(line.split('=', 1) for line in Path('/opt/rhi/supabase/.env').read_text().splitlines()
           if '=' in line and not line.startswith('#'))
resolve = socket.getaddrinfo
socket.getaddrinfo = lambda host, *a, **kw: resolve('127.0.0.1' if host == 'api-rhi.polesheadlamp.id' else host, *a, **kw)
base = 'https://api-rhi.polesheadlamp.id'
admin = {'apikey': env['SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + env['SERVICE_ROLE_KEY']}
anon = {'apikey': env['ANON_KEY'], 'Authorization': 'Bearer ' + env['ANON_KEY']}

def request(method, path, headers=anon, **kw):
    return requests.request(method, base + path, headers=headers, timeout=90, **kw)

if args.action == 'prepare':
    assert not fixture.exists()
    data = {'email': 'rhi-migration-preview-' + uuid.uuid4().hex + '@example.invalid',
            'password': secrets.token_urlsafe(36)}
    response = request('POST', '/auth/v1/admin/users', admin, json={**data, 'email_confirm': True,
        'user_metadata': {'name': 'Migration preview check', 'role': 'Owner'}})
    assert response.ok, response.status_code
    user = response.json().get('user') or response.json()
    data['id'] = str(uuid.UUID(user['id']))
    fixture.write_text(json.dumps(data))
    # The API write fence must remain enabled during public-preview checks.
    # Only the migration administrator creates this new, disposable profile.
    spec = importlib.util.spec_from_file_location('delta', root / 'plan-delta.py')
    delta = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(delta)
    db = delta.connection_target(admin=True)
    with db, db.cursor() as cur:
        cur.execute('insert into public.profiles (id,email,name,role,status,employment_status) '
                    'values (%s,%s,%s,%s,%s,%s)',
                    (data['id'], data['email'], 'Migration preview check', 'Owner', 'active', 'permanent'))
    db.close()
    print('Private preview fixture prepared')
else:
    data = json.loads(fixture.read_text())
    assert data['email'].startswith('rhi-migration-preview-') and data['email'].endswith('@example.invalid')
    spec = importlib.util.spec_from_file_location('delta', root / 'plan-delta.py')
    delta = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(delta)
    db = delta.connection_target(admin=True)
    if args.action == 'cleanup':
        with db, db.cursor() as cur:
            if data.get('write_marker'):
                assert data['write_marker'].startswith('rhi-preview-write-must-fail-')
                cur.execute('delete from public.meta_conversion_events where order_id=%s', (data['write_marker'],))
                cur.execute('delete from public.orders where id=%s', (data['write_marker'],))
            cur.execute('delete from auth.users where id=%s and email=%s', (data['id'], data['email']))
            cur.execute('select count(*) from public.profiles where id=%s', (data['id'],))
            assert cur.fetchone()[0] == 0
        fixture.unlink()
        print('Preview fixture and sessions removed')
    else:
        response = request('POST', '/auth/v1/token?grant_type=password', json={k: data[k] for k in ('email', 'password')})
        assert response.ok, ('login', response.status_code)
        tokens = response.json()
        def issuer(token):
            payload = token.split('.')[1]
            return json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))['iss']
        assert issuer(tokens['access_token']) == base + '/auth/v1', 'Login token issuer differs from frontend expectation'
        headers = {**anon, 'Authorization': 'Bearer ' + tokens['access_token'], 'x-client-token': tokens['access_token']}
        response = request('GET', '/auth/v1/user', headers)
        assert response.ok and response.json()['id'] == data['id'], ('user', response.status_code)
        response = request('GET', '/functions/v1/make-server-f781cd00/app-data/orders?from=0&to=0', headers)
        assert response.ok and response.json()['rowCount'] == 1, ('read', response.status_code)
        response = request('POST', '/auth/v1/token?grant_type=refresh_token', json={'refresh_token': tokens['refresh_token']})
        assert response.ok, ('refresh', response.status_code)
        assert issuer(response.json()['access_token']) == base + '/auth/v1', 'Refreshed token issuer differs'
        marker = 'rhi-preview-write-must-fail-' + uuid.uuid4().hex
        data['write_marker'] = marker
        fixture.write_text(json.dumps(data))
        response = request('POST', '/rest/v1/orders', admin, json={'id': marker, 'status': 'pending'})
        assert response.status_code >= 400 and response.json().get('code') == '25006', ('direct fence', response.status_code)
        response = request('POST', '/functions/v1/make-server-f781cd00/app-data/orders', headers, json={'id': marker, 'status': 'pending'})
        assert response.status_code >= 400, ('edge fence', response.status_code)
        with db, db.cursor() as cur:
            cur.execute('select count(*) from public.orders where id=%s', (marker,))
            assert cur.fetchone()[0] == 0
        for table in ('public.orders', 'storage.objects'):
            try:
                with db, db.cursor() as cur:
                    cur.execute('SET SESSION AUTHORIZATION authenticator; SET ROLE service_role')
                    cur.execute('update ' + table + ' set id=id where false')
            except Exception as error:
                assert getattr(error, 'pgcode', None) == '25006', (table, getattr(error, 'pgcode', None))
            else:
                raise AssertionError('Database fence missing for ' + table)
        report = {'login': True, 'refresh': True, 'frontend_issuer_matched': True, 'auth_user_verified': True,
                  'order_read': True, 'direct_api_write_denied': True,
                  'edge_api_write_denied': True, 'database_business_and_storage_fence': True}
        (root / 'preview-readonly-verification.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report))
    db.close()
