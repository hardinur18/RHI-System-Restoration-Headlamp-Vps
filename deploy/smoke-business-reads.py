#!/usr/bin/env python3
"""Check private staging business reads and anonymous denial, without business writes.

Only a marked temporary Auth/profile fixture is created and removed. Reports
contain status codes, never business responses or credentials. This is read
coverage, not full transactional UAT.
"""
import json
import os
from pathlib import Path
import secrets
import socket
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
prefix = '/functions/v1/make-server-f781cd00'
admin = {'apikey': env['SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + env['SERVICE_ROLE_KEY']}
anon = {'apikey': env['ANON_KEY'], 'Authorization': 'Bearer ' + env['ANON_KEY']}
types = ('branches areas services vehicle_types payment_methods cancel_reasons ad_platforms '
         'ad_sub_channels ad_accounts ad_account_assignments ad_account_owner_assignments '
         'ad_sources roles profiles affiliates vendors leads prospect_labels prospect_bookings '
         'orders wa_templates daily_ads lead_spam_daily_inputs proof_assets technician_schedules audit_logs').split()
paths = ['/app-data/' + name + '?from=0&to=1' for name in types] + [
    '/finance/operational-expense-categories', '/finance/recurring-expense-payments?limit=2',
    '/finance/operational-expenses?limit=2', '/finance/operational-expenses/summary',
    '/stock/settings', '/stock/products', '/stock/transactions', '/payroll/data']
fixture = root / 'business-read-fixture.json'
assert not fixture.exists(), 'Prior fixture requires cleanup before another run'
user_id = None
results = []
cleanup = False


def call(method, path, headers, **kwargs):
    return requests.request(method, base + path, headers=headers, timeout=90, **kwargs)


try:
    email = 'rhi-migration-reads-' + uuid.uuid4().hex + '@example.invalid'
    password = secrets.token_urlsafe(36)
    response = call('POST', '/auth/v1/admin/users', admin, json={
        'email': email, 'password': password, 'email_confirm': True,
        'user_metadata': {'name': 'Migration read check', 'role': 'Owner'}})
    assert response.ok, 'Fixture creation failed'
    user = response.json().get('user') or response.json()
    user_id = str(uuid.UUID(user['id']))
    fixture.write_text(json.dumps({'id': user_id, 'email': email}))
    response = call('POST', '/rest/v1/profiles', {**admin, 'Prefer': 'resolution=merge-duplicates'}, json={
        'id': user_id, 'email': email, 'name': 'Migration read check', 'role': 'Owner',
        'status': 'active', 'branch_id': None, 'employment_status': 'permanent'})
    assert response.ok, 'Fixture profile failed'
    response = call('POST', '/auth/v1/token?grant_type=password', anon,
                    json={'email': email, 'password': password})
    assert response.ok, 'Fixture login failed'
    token = response.json()['access_token']
    headers = {**anon, 'Authorization': 'Bearer ' + token, 'x-client-token': token}
    for path in paths:
        response = call('GET', prefix + path, headers)
        denied = call('GET', prefix + path, anon)
        body = response.json()
        passed = response.status_code == 200 and denied.status_code in (401, 403)
        passed = passed and not (isinstance(body, dict) and (body.get('error') or body.get('success') is False))
        results.append({'path': path, 'owner_status': response.status_code,
                        'anonymous_status': denied.status_code, 'passed': bool(passed)})
        print(('PASS ' if passed else 'FAIL ') + path, flush=True)
finally:
    if user_id:
        a = call('DELETE', '/rest/v1/profiles?id=eq.' + user_id, admin)
        b = call('DELETE', '/auth/v1/admin/users/' + user_id, admin)
        cleanup = a.ok and (b.ok or b.status_code == 404)
        if cleanup:
            fixture.unlink(missing_ok=True)
    report = {'checks': results, 'fixture_cleaned': cleanup,
              'scope': 'Business reads and anonymous denial; no business transactions submitted'}
    (root / 'business-read-verification.json').write_text(json.dumps(report, indent=2))
assert cleanup and len(results) == len(paths) and all(row['passed'] for row in results)
print('All business read checks passed; fixture removed:', len(results), flush=True)
