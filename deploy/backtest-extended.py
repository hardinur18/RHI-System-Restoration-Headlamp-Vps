#!/usr/bin/env python3
"""Broader regression checks on disposable UAT, with exact fixture cleanup."""
import importlib.util
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
root = Path('/opt/rhi/uat-20261106')
base = 'http://127.0.0.1:18080'
assert requests.get(base + '/__rhi/uat', timeout=10).json()['database'] == 'rhi_uat_20261106'
keys = json.loads((root / 'keys.json').read_text())
admin = {'apikey': keys['SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + keys['SERVICE_ROLE_KEY']}
anon = {'apikey': keys['ANON_KEY'], 'Authorization': 'Bearer ' + keys['ANON_KEY']}
prefix = '/functions/v1/make-server-f781cd00'
spec = importlib.util.spec_from_file_location('delta', '/opt/rhi/migration/plan-delta.py')
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)
db = delta.connection_target(admin=True, database='rhi_uat_20261106')
with db, db.cursor() as cur:
    cur.execute('select current_database()')
    assert cur.fetchone()[0] == 'rhi_uat_20261106'
fixture = root / 'extended-fixture.json'
cleanup_only = '--cleanup-only' in sys.argv
assert cleanup_only or not fixture.exists(), 'Clean previous fixtures first'
state = json.loads(fixture.read_text()) if cleanup_only else {
    'marker': 'rhi-backtest-' + uuid.uuid4().hex, 'users': [], 'recurring_id': str(uuid.uuid4())}
marker = state['marker']
checks = []
accounts = {}

def save():
    fixture.write_text(json.dumps(state))

def raw(method, path, headers=admin, payload=None):
    return requests.request(method, base + path, headers=headers, timeout=60,
        **({'json': payload} if payload is not None else {}))

def call(method, path, headers=admin, payload=None):
    response = raw(method, path, headers, payload)
    assert response.ok, '%s %s HTTP %s' % (method, path, response.status_code)
    return response.json() if response.content else None

def api(method, path, payload=None, role='Owner'):
    return call(method, prefix + path, accounts[role]['headers'], payload)

def record(name, condition, **details):
    checks.append({'check': name, 'passed': bool(condition), **details})
    print(('PASS ' if condition else 'FAIL ') + name, flush=True)

def scenario(name, fn):
    try:
        fn()
    except Exception as error:
        # Never record business response bodies or tokens.
        record(name, False, exception_type=type(error).__name__)

try:
    if cleanup_only:
        raise SystemExit(0)
    save()
    for role in ['Owner', 'Super Admin', 'Admin PIC', 'CS', 'Teknisi', 'Finance', 'Advertiser']:
        email = marker + '-' + role.lower().replace(' ', '-') + '@example.invalid'
        password = secrets.token_urlsafe(32)
        user = call('POST', '/auth/v1/admin/users', payload={'email': email, 'password': password,
            'email_confirm': True, 'user_metadata': {'name': marker, 'role': role}})
        uid = (user.get('user') or user)['id']
        state['users'].append(uid)
        save()
        call('POST', '/rest/v1/profiles', payload={'id': uid, 'email': email, 'name': marker,
            'role': role, 'status': 'active', 'employment_status': 'permanent'})
        token = call('POST', '/auth/v1/token?grant_type=password', anon,
            {'email': email, 'password': password})['access_token']
        accounts[role] = {'id': uid, 'headers': {**anon, 'Authorization': 'Bearer ' + token, 'x-client-token': token}}
        info = api('GET', '/permissions/me', role=role)['data']
        record('Role login and identity: ' + role, info['role'].lower() == role.lower()
            and info['isOwner'] == (role == 'Owner'))

    read_paths = ['/permissions/global', '/permissions/settings', '/permissions/user/' + accounts['Owner']['id'],
        '/embed/admin/forms', '/manual-debts', '/reports?date=2099-01-01', '/targets/2099-01',
        '/cs-okr-targets/2099-01', '/ads/sync-status', '/ads/sync-health',
        '/meta/integration-configs', '/google/integration-configs', '/tiktok/integration-configs',
        '/meta/snapshots?from=2026-11-01&to=2026-11-06',
        '/google/snapshots?from=2026-11-01&to=2026-11-06',
        '/tiktok/snapshots?from=2026-11-01&to=2026-11-06',
        '/meta/messaging/channels', '/meta/messaging/kirimdev/status',
        '/meta/messaging/whatsapp/contacts', '/meta/messaging/whatsapp/broadcasts',
        '/mobile/technician-orders/' + accounts['Teknisi']['id'],
        '/shifts/' + accounts['Teknisi']['id'] + '/2099-01-01']
    for path in read_paths:
        response = raw('GET', prefix + path, accounts['Owner']['headers'])
        denied = raw('GET', prefix + path, anon)
        body = response.json() if response.headers.get('content-type', '').startswith('application/json') else None
        # This endpoint deliberately exposes only scheduler health, as on source.
        public_health = path == '/ads/sync-health'
        anonymous_ok = denied.status_code in (401, 403)
        if public_health:
            anonymous_ok = denied.status_code == 200 and set(denied.json()).issubset({
                'ok', 'scheduler', 'lastStartedAt', 'lastFinishedAt', 'lastSuccessAt', 'lastStatus', 'checkedAt'})
        record(('Public scheduler health: ' if public_health else 'Protected read: ') + path.split('?')[0], response.status_code == 200
            and anonymous_ok and not (isinstance(body, dict) and body.get('error')),
            owner_status=response.status_code, anonymous_status=denied.status_code)

    def debt():
        payload = {'id': marker, 'user_name': marker, 'amount': 10000, 'status': 'unpaid', 'type': 'receivable'}
        created = api('POST', '/manual-debts', payload)
        record('Debt create', created['amount'] == 10000)
        api('PUT', '/manual-debts/' + marker, {**payload, 'status': 'paid', 'amount': 0})
        found = next(row for row in api('GET', '/manual-debts') if row['id'] == marker)
        record('Debt settle persists', found['status'] == 'paid' and found['amount'] == 0)
        api('DELETE', '/manual-debts/' + marker)
        record('Debt delete persists', not any(row['id'] == marker for row in api('GET', '/manual-debts')))
    scenario('Debt lifecycle', debt)

    def shift():
        uid = accounts['Teknisi']['id']
        api('POST', '/shifts', {'userId': uid, 'date': '2099-01-01', 'data': {'status': 'active', 'fixture': marker}}, role='Teknisi')
        record('Technician starts own shift', api('GET', '/shifts/' + uid + '/2099-01-01', role='Teknisi')['status'] == 'active')
        denied = raw('POST', prefix + '/shifts', accounts['Teknisi']['headers'],
            {'userId': accounts['Owner']['id'], 'date': '2099-01-01', 'data': {'status': 'active'}})
        record('Technician cannot change another user shift', denied.status_code == 403)
        api('POST', '/shifts', {'userId': uid, 'date': '2099-01-01', 'data': {'status': 'completed', 'fixture': marker}}, role='Teknisi')
        record('Technician finishes own shift', api('GET', '/shifts/' + uid + '/2099-01-01', role='Teknisi')['status'] == 'completed')
        api('DELETE', '/shifts/' + uid + '/2099-01-01')
        record('Admin resets shift', api('GET', '/shifts/' + uid + '/2099-01-01') is None)
    scenario('Shift lifecycle', shift)

    def report():
        payload = {'id': marker, 'date': '2099-01-01', 'technicianId': accounts['Teknisi']['id'],
            'technicianName': marker, 'notes': marker, 'totalIncome': 10000}
        result = api('POST', '/reports', payload)
        record('Operational report create', result['id'] == marker)
        api('POST', '/reports', {**payload, 'totalIncome': 12000})
        found = [row for row in api('GET', '/reports?date=2099-01-01') if row['id'] == marker]
        record('Operational report update keeps one record', len(found) == 1 and found[0]['totalIncome'] == 12000)
        api('DELETE', '/reports/' + marker)
        record('Operational report delete persists', not any(row['id'] == marker for row in api('GET', '/reports?date=2099-01-01')))
    scenario('Operational report lifecycle', report)

    def recurring():
        call('POST', '/rest/v1/recurring_expenses', payload={'id': state['recurring_id'], 'name': marker,
            'category': 'UAT', 'amount': 10000, 'cycle': 'monthly', 'due_date': 1})
        payload = {'recurring_expense_id': state['recurring_id'], 'period_key': '2099-01',
            'due_date': '2099-01-01', 'paid_at': '2099-01-01', 'amount': 10000,
            'operational_category': 'UAT', 'operational_subcategory': marker, 'notes': marker,
            'description': marker, 'payment_source': 'cash'}
        denied = raw('POST', prefix + '/finance/recurring-expenses/pay', accounts['CS']['headers'], payload)
        record('CS cannot pay recurring expense', denied.status_code == 403)
        result = api('POST', '/finance/recurring-expenses/pay', payload)
        record('Recurring payment creates ledger link', bool(result['data'][0]['operational_expense_id']))
        retry = raw('POST', prefix + '/finance/recurring-expenses/pay', accounts['Owner']['headers'], payload)
        record('Duplicate recurring payment rejected', retry.status_code == 400)
        rows = api('GET', '/finance/recurring-expense-payments?recurringExpenseId=' + state['recurring_id'])['data']
        record('Recurring payment persisted once', len(rows) == 1 and float(rows[0]['amount']) == 10000)
    scenario('Recurring payment lifecycle', recurring)
finally:
    with db, db.cursor() as cur:
        cur.execute('delete from public.recurring_expense_payments where recurring_expense_id=%s', (state['recurring_id'],))
        cur.execute('delete from public.operational_expense_ledger where source_ref=%s', ('recurring:' + state['recurring_id'] + ':2099-01',))
        cur.execute('delete from public.recurring_expenses where id=%s', (state['recurring_id'],))
        cur.execute("delete from public.kv_store_f781cd00 where key=ANY(%s) or value->>'fixture'=%s or (key like 'audit:%%' and value->>'user'=%s)",
            (['debt:' + marker, 'report:' + marker] + ['shift:' + uid + ':2099-01-01' for uid in state['users']], marker, marker))
    for uid in state['users']:
        call('DELETE', '/rest/v1/profiles?id=eq.' + uid)
        response = raw('DELETE', '/auth/v1/admin/users/' + uid)
        assert response.ok or response.status_code == 404
    with db, db.cursor() as cur:
        for table in ['profiles', 'recurring_expenses', 'recurring_expense_payments', 'operational_expense_ledger', 'kv_store_f781cd00']:
            cur.execute('select count(*) from public.' + table + ' t where to_jsonb(t)::text like %s', ('%' + marker + '%',))
            assert cur.fetchone()[0] == 0, 'Cleanup incomplete: ' + table
    db.close()
    fixture.unlink(missing_ok=True)
    if not cleanup_only:
        (root / 'extended-backtest.json').write_text(json.dumps({'checks': checks, 'fixtures_cleaned': True,
            'passed': bool(checks) and all(row['passed'] for row in checks), 'external_actions_sent': False}, indent=2))
assert checks and all(row['passed'] for row in checks), 'Some checks failed; see private report'
print('Extended checks passed:', len(checks))
