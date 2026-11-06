#!/usr/bin/env python3
"""Exercise payroll, lead forms, booking and private Storage on disposable UAT only."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket
import uuid
import requests

assert socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
root = Path('/opt/rhi/uat-20261106')
assert json.loads((root / 'baseline-verification.json').read_text())['all_tables_matched']
spec = importlib.util.spec_from_file_location('delta', '/opt/rhi/migration/plan-delta.py')
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)
db = delta.connection_target(admin=True, database='rhi_uat_20261106')
with db, db.cursor() as cur:
    cur.execute('select current_database()')
    assert cur.fetchone()[0] == 'rhi_uat_20261106'
keys = json.loads((root / 'keys.json').read_text())
base = 'http://127.0.0.1:18080'
prefix = '/functions/v1/make-server-f781cd00'
admin = {'apikey': keys['SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + keys['SERVICE_ROLE_KEY']}
anon = {'apikey': keys['ANON_KEY'], 'Authorization': 'Bearer ' + keys['ANON_KEY']}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--cleanup-only', action='store_true')
args = parser.parse_args()
marker = 'rhi-uat-' + uuid.uuid4().hex
fixture = root / 'workflow-fixture.json'
assert args.cleanup_only or not fixture.exists(), 'Clean prior fixtures before retrying'
state = {'marker': marker, 'users': [], 'period': None, 'bucket_created': False}
if args.cleanup_only:
    state = json.loads(fixture.read_text())
    marker = state['marker']
checks = []
issues = []
passed = False

def save():
    fixture.write_text(json.dumps(state, indent=2))

def response(method, path, headers=None, **kwargs):
    return requests.request(method, base + path, headers=headers or admin, timeout=90, **kwargs)

def call(method, path, headers=None, **kwargs):
    r = response(method, path, headers, **kwargs)
    if not r.ok:
        (root / 'last-workflow-error.json').write_text(json.dumps({'path': path, 'status': r.status_code, 'body': r.text}))
    assert r.ok, (method, path, r.status_code)
    return r.json() if r.content else None

def check(name, value):
    assert value, name
    checks.append(name)
    print('PASS ' + name, flush=True)

def create(role):
    email, password = marker + '-' + role.lower() + '@example.invalid', secrets.token_urlsafe(32)
    user = call('POST', '/auth/v1/admin/users', json={'email': email, 'password': password,
        'email_confirm': True, 'user_metadata': {'name': marker, 'role': role}})
    user_id = (user.get('user') or user)['id']
    state['users'].append(user_id)
    save()
    call('POST', '/rest/v1/profiles', {**admin, 'Prefer': 'resolution=merge-duplicates'}, json={
        'id': user_id, 'email': email, 'name': marker, 'role': role, 'status': 'active', 'employment_status': 'permanent'})
    token = call('POST', '/auth/v1/token?grant_type=password', anon, json={'email': email, 'password': password})['access_token']
    return user_id, {**anon, 'Authorization': 'Bearer ' + token, 'x-client-token': token}

try:
    if args.cleanup_only:
        raise SystemExit(0)
    save()
    owner_id, owner = create('Owner')
    member_id, member = create('CS')
    with db, db.cursor() as cur:
        for year in range(2090, 2200):
            period = str(year) + '-01'
            cur.execute('select 1 from public.payroll_runs where period_key=%s', (period,))
            if cur.fetchone() is None:
                break
        else:
            raise AssertionError('No empty test payroll period')
    state['period'] = period
    save()
    payroll = prefix + '/payroll'
    for headers, label in ((anon, 'anonymous'), (member, 'CS')):
        check(label + ' payroll mutation denied', response('POST', payroll + '/salary', headers, json={}).status_code in (401, 403))
    check('payroll rejects malformed period', response('POST', payroll + '/salary', owner,
        json={'user_id': member_id, 'period_key': 'invalid'}).status_code == 400)
    salary = call('POST', payroll + '/salary', owner, json={'user_id': member_id, 'period_key': period,
        'basic_salary': 3000000, 'allowance_fixed': 200000, 'period_deduction_amount': 50000,
        'period_deduction_note': marker})
    check('salary profile saved', salary['salary']['basic_salary'] == 3000000)
    deductions = call('GET', '/rest/v1/payroll_deductions?user_id=eq.' + member_id)
    check('period deduction saved', len(deductions) == 1 and deductions[0]['amount'] == 50000)
    payload = {'run': {'period_key': period, 'period_label': marker, 'cutoff_start': period + '-01',
        'cutoff_end': period + '-31', 'employee_count': 1, 'fixed_cost': 3200000,
        'period_deductions_total': 50000, 'take_home_total': 3150000, 'grand_total': 3150000, 'notes': marker},
        'items': [{'user_id': member_id, 'employee_name': marker, 'employee_role': 'CS',
            'basic_salary': 3000000, 'allowance_fixed': 200000, 'period_deductions': 50000, 'take_home_pay': 3150000}]}
    run = call('POST', payroll + '/runs', owner, json=payload)['run']
    check('payroll snapshot locked', run['status'] == 'locked' and run['take_home_total'] == 3150000)
    posted = call('POST', payroll + '/runs/' + run['id'] + '/post', owner, json={})
    check('payroll posted to expense ledger', posted['run']['status'] == 'posted')
    again = call('POST', payroll + '/runs/' + run['id'] + '/post', owner, json={})
    ledger = call('GET', '/rest/v1/operational_expense_ledger?source_ref=eq.payroll:' + period)
    check('repeated payroll posting creates no duplicate expense', len(ledger) == 1 and
        ledger[0]['amount'] == 3150000 and again['operationalExpenseId'] == posted['operationalExpenseId'])
    check('posted payroll cannot be overwritten', response('POST', payroll + '/runs', owner, json=payload).status_code == 409)

    bundle = call('POST', prefix + '/embed/admin/forms', owner, json={'form': {'name': marker, 'slug': marker,
        'status': 'active', 'fallback_cs_id': member_id, 'allowed_embed_origins': [base]},
        'fields': [{'field_key': 'name', 'label': 'Nama', 'input_type': 'text', 'is_required': True},
                   {'field_key': 'phone', 'label': 'Telepon', 'input_type': 'tel', 'is_required': True}],
        'routes': [{'cs_id': member_id, 'status': 'active'}]})['bundle']
    state['form_id'] = bundle['form']['id']
    save()
    public_headers = {**anon, 'Origin': base}
    form_path = prefix + '/embed/public/forms/' + marker
    check('public form loads without routing details', call('GET', form_path, public_headers)['bundle']['routes'] == [])
    check('form rejects disallowed origin', response('GET', form_path, {**anon, 'Origin': 'https://invalid.example'}).status_code == 403)
    check('form requires identity', response('POST', form_path + '/submit', public_headers, json={'answers': {}}).status_code == 400)
    submission = call('POST', form_path + '/submit', public_headers,
        json={'answers': {'name': marker, 'phone': '0000000000', 'notes': marker}, 'landingPageUrl': base,
              'utm': {'utm_source': marker}})
    lead = call('GET', '/rest/v1/leads?id=eq.' + submission['leadId'])[0]
    check('form submission creates lead with attribution and CS', lead['name'] == marker and
        lead['cs_id'] == member_id and lead['utm_source'] == marker)
    records = call('GET', '/rest/v1/embed_lead_form_submissions?id=eq.' + submission['submissionId'])
    check('form submission recorded as processed', len(records) == 1 and records[0]['status'] == 'lead_created')
    check('duplicate public booking rejected', response('POST', prefix + '/public/affiliate-bookings', anon,
        json={'name': marker, 'phone': '0000000000', 'address': marker}).status_code == 409)
    booking = call('POST', prefix + '/public/affiliate-bookings', anon,
        json={'name': marker, 'phone': '0000000001', 'address': marker, 'notes': marker})
    lead = call('GET', '/rest/v1/leads?id=eq.' + booking['leadId'])[0]
    if lead.get('origin') != 'affiliate_public_booking':
        issues.append({'check': 'public booking attribution', 'expected': 'affiliate_public_booking', 'actual': lead.get('origin')})
        print('FAIL public booking attribution; continuing independent checks', flush=True)
    else:
        check('public booking creates attributable lead', True)
    call('DELETE', prefix + '/embed/admin/forms/' + state['form_id'], owner)
    check('deleted form no longer public', response('GET', form_path, public_headers).status_code == 404)

    call('POST', '/storage/v1/bucket', json={'id': marker, 'name': marker, 'public': False})
    state['bucket_created'] = True
    save()
    blob = b'RHI isolated upload integrity\n' + secrets.token_bytes(2048)
    object_path = '/storage/v1/object/' + marker + '/test.bin'
    call('POST', object_path, {**admin, 'Content-Type': 'application/octet-stream'}, data=blob)
    check('private Storage upload and download match', response('GET', object_path).content == blob)
    check('private Storage anonymous read denied', response('GET', object_path, anon).status_code in (400,401,403,404))
    signed = call('POST', '/storage/v1/object/sign/' + marker + '/test.bin', json={'expiresIn': 60})['signedURL']
    check('signed private download matches', requests.get(base + '/storage/v1' + signed, timeout=30).content == blob)
    ranged = response('GET', object_path, {**admin, 'Range': 'bytes=0-9'})
    check('Storage range download matches', ranged.status_code == 206 and ranged.content == blob[:10])
    call('DELETE', '/storage/v1/object/' + marker, json={'prefixes': ['test.bin']})
    check('deleted file no longer downloadable', response('GET', object_path).status_code in (400,404))
    passed = not issues
finally:
    # All writes and cleanup are confined to this disposable database.
    with db, db.cursor() as cur:
        cur.execute('delete from public.embed_lead_form_submissions where customer_name=%s', (marker,))
        cur.execute('delete from public.embed_lead_forms where slug=%s', (marker,))
        cur.execute('delete from public.leads where name=%s', (marker,))
        if state['period']:
            cur.execute('delete from public.payroll_runs where period_key=%s and notes=%s', (state['period'], marker))
            cur.execute('delete from public.operational_expense_ledger where source_ref=%s and created_by::text=ANY(%s)',
                ('payroll:' + state['period'], state['users']))
        for table in ('payroll_deductions', 'employee_kpi_assignments', 'salary_profiles'):
            cur.execute('delete from public.' + table + ' where user_id::text=ANY(%s)', (state['users'],))
        cur.execute("delete from public.kv_store_f781cd00 where key like 'audit:%%' and value->>'user'=%s", (marker,))
    for user_id in state['users']:
        call('DELETE', '/rest/v1/profiles?id=eq.' + user_id)
        call('DELETE', '/auth/v1/admin/users/' + user_id)
    if state['bucket_created']:
        call('DELETE', '/storage/v1/object/' + marker, json={'prefixes': ['test.bin']})
        call('DELETE', '/storage/v1/bucket/' + marker)
    with db, db.cursor() as cur:
        for table in ('leads', 'embed_lead_forms', 'embed_lead_form_submissions', 'payroll_runs', 'payroll_run_items',
                      'profiles', 'operational_expense_ledger'):
            cur.execute('select count(*) from public.' + table + ' t where to_jsonb(t)::text like %s', ('%' + marker + '%',))
            assert cur.fetchone()[0] == 0, 'Fixture left in ' + table
    fixture.unlink()
    (root / 'workflow-verification.json').write_text(json.dumps({'passed': passed, 'checks': checks, 'issues': issues,
        'fixtures_cleaned': True, 'scope': 'API workflows on private cloned database; external providers blocked'}, indent=2))
print('UAT checks passed:', len(checks), flush=True)

assert passed, 'UAT findings remain; inspect workflow-verification.json'
