#!/usr/bin/env python3
"""Exercise isolated staging writes with unique fixtures and verified cleanup.

Never run after cutover: requires a private API, isolated workers and disabled
cron. Uses real Auth and application endpoints; does not contact providers.
"""
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import uuid

import requests

assert socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
root = Path('/opt/rhi/migration')
spec = importlib.util.spec_from_file_location('delta', root / 'plan-delta.py')
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)
db = delta.connection_target(admin=True)
with db, db.cursor() as cur:
    cur.execute('show cron.launch_active_jobs')
    assert cur.fetchone()[0] == 'off'
    cur.execute('select count(*) from cron.job where active')
    assert cur.fetchone()[0] == 0
networks = json.loads(subprocess.check_output(['docker', 'inspect', 'supabase-edge-functions']))[0]['NetworkSettings']['Networks']
for network in networks:
    assert json.loads(subprocess.check_output(['docker', 'network', 'inspect', network]))[0]['Internal']
nginx = subprocess.check_output(['nginx', '-T'], stderr=subprocess.DEVNULL, text=True)
assert nginx.count('deny all;') >= 2 and 'allow 172.30.44.0/24;' in nginx

env = dict(line.split('=', 1) for line in Path('/opt/rhi/supabase/.env').read_text().splitlines()
           if '=' in line and not line.startswith('#'))
resolve = socket.getaddrinfo
socket.getaddrinfo = lambda host, *args, **kwargs: resolve(
    '127.0.0.1' if host == 'api-rhi.polesheadlamp.id' else host, *args, **kwargs)
base = 'https://api-rhi.polesheadlamp.id'
prefix = '/functions/v1/make-server-f781cd00'
admin = {'apikey': env['SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + env['SERVICE_ROLE_KEY']}
anon = {'apikey': env['ANON_KEY'], 'Authorization': 'Bearer ' + env['ANON_KEY']}
marker = 'rhi-migration-uat-' + uuid.uuid4().hex
fixture = root / 'business-write-fixture.json'
assert not fixture.exists(), 'Prior fixture requires cleanup first'
state = {'marker': marker, 'user_id': None, 'stock_transactions': []}
checks = []
cleaned = False
passed = False

def save():
    fixture.write_text(json.dumps(state, indent=2))

def call(method, path, headers, **kwargs):
    response = requests.request(method, base + path, headers=headers, timeout=90, **kwargs)
    assert response.ok, (method, path, response.status_code)
    return response.json() if response.content else None

def check(name, condition):
    assert condition, name
    checks.append(name)
    print('PASS ' + name, flush=True)

try:
    save()
    password = secrets.token_urlsafe(36)
    email = marker + '@example.invalid'
    user = call('POST', '/auth/v1/admin/users', admin, json={
        'email': email, 'password': password, 'email_confirm': True,
        'user_metadata': {'name': marker, 'role': 'Owner'}})
    state['user_id'] = (user.get('user') or user)['id']
    save()
    call('POST', '/rest/v1/profiles', {**admin, 'Prefer': 'resolution=merge-duplicates'}, json={
        'id': state['user_id'], 'email': email, 'name': marker, 'role': 'Owner',
        'status': 'active', 'branch_id': None, 'employment_status': 'permanent'})
    token = call('POST', '/auth/v1/token?grant_type=password', anon,
                 json={'email': email, 'password': password})['access_token']
    headers = {**anon, 'Authorization': 'Bearer ' + token, 'x-client-token': token}

    def api(method, path, payload=None):
        return call(method, prefix + path, headers, **({'json': payload} if payload is not None else {}))

    for path in ('/app-data/orders', '/app-data/affiliates', '/stock/transactions', '/finance/operational-expenses'):
        response = requests.post(base + prefix + path, headers=anon, json={}, timeout=30)
        check('anonymous write denied ' + path, response.status_code in (401, 403))

    order = {'id': marker, 'customer_name': marker, 'customer_phone': '0000000000',
             'status': 'pending', 'price': 125000, 'income': 0, 'notes': marker,
             'service_date': '2099-01-01', 'lat': -6.2, 'lng': 106.8}
    created = api('POST', '/app-data/orders', order)['row']
    check('order created with amount and map coordinates', created['price'] == 125000 and created['lat'] == -6.2)
    for status in ('otw', 'working', 'qc', 'done'):
        updated = api('PUT', '/app-data/orders/' + marker, {'status': status, 'income': 125000})['row']
        check('order status ' + status, updated['status'] == status and updated['income'] == 125000)
    api('DELETE', '/app-data/orders/' + marker)
    check('order delete persisted', not call('GET', '/rest/v1/orders?id=eq.' + marker, admin))

    affiliate = api('POST', '/app-data/affiliates', {'id': marker, 'nama_lengkap': marker,
        'no_whatsapp': '0000000000', 'komisi': 10000})['row']
    check('affiliate created', affiliate['komisi'] == 10000)
    updated = api('PUT', '/app-data/affiliates/' + marker, {'komisi': 15000})['row']
    check('affiliate updated', updated['komisi'] == 15000)
    api('DELETE', '/app-data/affiliates/' + marker)
    check('affiliate delete persisted', not call('GET', '/rest/v1/affiliates?id=eq.' + marker, admin))

    state['schedule_id'] = str(uuid.uuid4())
    save()
    schedule = api('POST', '/app-data/technician_schedules', {'id': state['schedule_id'],
        'user_id': state['user_id'], 'date': '2099-01-01', 'type': 'Cuti', 'reason': marker})['row']
    check('technician schedule created', schedule['type'] == 'Cuti')
    api('DELETE', '/app-data/technician_schedules/' + state['schedule_id'])
    check('technician schedule delete persisted', not call('GET', '/rest/v1/technician_schedules?id=eq.' + state['schedule_id'], admin))

    api('POST', '/stock/products', {'id': marker, 'name': marker, 'unit': 'pcs'})
    for kind, quantity, price, expected_qty, expected_avg in [('IN', 10, 100, 10, 100),
            ('IN', 10, 200, 20, 150), ('OUT', 5, 0, 15, 150)]:
        result = api('POST', '/stock/transactions', {'type': kind, 'productId': marker,
            'quantity': quantity, 'unitPrice': price, 'notes': marker, 'relatedId': marker})
        state['stock_transactions'].append(result['transaction']['id'])
        save()
        check('stock ' + kind + ' quantity and weighted cost ' + str(expected_qty),
              result['product']['current_qty'] == expected_qty and result['product']['average_cost'] == expected_avg)
    api('DELETE', '/stock/products/' + marker)

    category_payload = {'category': marker, 'subcategory': 'test', 'account_type': 'expense'}
    category = api('POST', '/finance/operational-expense-categories', category_payload)['data']
    state['category_id'] = category['id']
    save()
    expense_payload = {'expense_date': '2099-01-01', 'category': marker, 'subcategory': 'test',
                       'amount': 10000, 'notes': marker, 'source_ref': marker}
    expense = api('POST', '/finance/operational-expenses', expense_payload)['data']
    state['expense_id'] = expense['id']
    save()
    check('operational expense created', expense['amount'] == 10000 and expense['status'] == 'active')
    updated = api('PUT', '/finance/operational-expenses/' + expense['id'], {**expense_payload, 'amount': 20000})['data']
    check('operational expense updated', updated['amount'] == 20000)
    voided = api('DELETE', '/finance/operational-expenses/' + expense['id'], {'reason': marker})['data']
    check('operational expense voided with reason', voided['status'] == 'void' and voided['void_reason'] == marker)
    passed = True
finally:
    # Only this invocation's marked fixtures are removed, never existing rows.
    with db, db.cursor() as cur:
        cur.execute('delete from public.meta_conversion_events where order_id=%s', (marker,))
        for table, column in [('orders', 'id'), ('affiliates', 'id'), ('operational_expense_ledger', 'source_ref'),
                              ('operational_expense_categories', 'category'), ('technician_schedules', 'reason')]:
            cur.execute('delete from public.' + table + ' where ' + column + '=%s', (marker,))
        cur.execute("delete from public.kv_store_f781cd00 where key=%s or "
                    "(key like 'stock_trx:%%' and value->>'productId'=%s) or "
                    "(key like 'audit:%%' and value->>'user'=%s)", ('stock_product:' + marker, marker, marker))
    if state['user_id']:
        call('DELETE', '/rest/v1/profiles?id=eq.' + state['user_id'], admin)
        call('DELETE', '/auth/v1/admin/users/' + state['user_id'], admin)
    with db, db.cursor() as cur:
        for table in ('orders', 'affiliates', 'operational_expense_ledger', 'operational_expense_categories',
                      'technician_schedules', 'meta_conversion_events', 'kv_store_f781cd00', 'profiles'):
            cur.execute('select count(*) from public.' + table + ' t where to_jsonb(t)::text like %s', ('%' + marker + '%',))
            assert cur.fetchone()[0] == 0, 'Fixture cleanup incomplete: ' + table
    cleaned = True
    fixture.unlink()
    (root / 'business-write-verification.json').write_text(json.dumps({
        'passed': passed, 'checks': checks, 'fixture_cleaned': cleaned, 'provider_actions_blocked': True,
        'scope': 'API order lifecycle, affiliate, technician schedule, stock costing, operational expenses; not full UI UAT'}, indent=2))
print('All selected business write checks passed; fixtures removed:', len(checks), flush=True)
