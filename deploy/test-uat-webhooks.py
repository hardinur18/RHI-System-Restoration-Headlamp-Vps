#!/usr/bin/env python3
"""Verify signed webhook ingress and replay protection on isolated UAT only.

Uses synthetic no-message payloads. Does not contact providers, send messages,
or change subscriptions. Removes only its own event/dedup records afterwards.
"""
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import socket
import time
import uuid
import requests

assert socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
root = Path('/opt/rhi/uat-20261106')
base = 'http://127.0.0.1:18080'
marker_response = requests.get(base + '/__rhi/uat', timeout=10)
assert marker_response.json()['database'] == 'rhi_uat_20261106'
env = dict(line.split('=', 1) for line in (root / 'rhi-uat-functions.env').read_text().splitlines() if '=' in line)
for key in ['META_APP_SECRET', 'META_MESSAGING_VERIFY_TOKEN', 'KIRIMDEV_WEBHOOK_SECRET']:
    assert env[key].startswith('uat-only-'), 'Refuse real provider credentials'
spec = importlib.util.spec_from_file_location('delta', '/opt/rhi/migration/plan-delta.py')
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)
db = delta.connection_target(admin=True, database='rhi_uat_20261106')
with db, db.cursor() as cur:
    cur.execute('select current_database()')
    assert cur.fetchone()[0] == 'rhi_uat_20261106'
marker = 'rhi-uat-webhook-' + uuid.uuid4().hex
checks = []
passed = False

def check(name, condition):
    assert condition, name
    checks.append(name)
    print('PASS ' + name, flush=True)

def post(path, body, headers=None):
    return requests.post(base + '/functions/v1/' + path, data=body,
        headers={'Content-Type': 'application/json', **(headers or {})}, timeout=60)

def sign(secret, body):
    return hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()

try:
    payload = json.dumps({'type': 'migration.test.no_message', 'data': {}, 'rhi_uat_fixture': marker})
    timestamp = str(int(time.time()))
    headers = {'x-kirim-event-id': marker, 'x-kirim-signature':
        't=' + timestamp + ',v1=' + sign(env['KIRIMDEV_WEBHOOK_SECRET'], timestamp + '.' + payload)}
    check('Kirimdev rejects missing signature', post('kirimdev-messaging-webhook', payload).status_code == 401)
    check('Kirimdev rejects tampered body', post('kirimdev-messaging-webhook', payload + ' ', headers).status_code == 401)
    expired = str(int(time.time()) - 86400)
    check('Kirimdev rejects expired signature', post('kirimdev-messaging-webhook', payload,
        {**headers, 'x-kirim-signature': 't=' + expired + ',v1=' + sign(env['KIRIMDEV_WEBHOOK_SECRET'], expired + '.' + payload)}).status_code == 401)
    result = post('kirimdev-messaging-webhook', payload, headers)
    check('Kirimdev accepts signed event', result.status_code == 200 and result.json().get('success'))
    result = post('kirimdev-messaging-webhook', payload, headers)
    check('Kirimdev deduplicates retried event', result.status_code == 200 and result.json().get('duplicate'))
    with db, db.cursor() as cur:
        cur.execute("select count(*) from public.kv_store_f781cd00 where value->'payload'->>'rhi_uat_fixture'=%s", (marker,))
        check('Kirimdev persists exactly one event', cur.fetchone()[0] == 1)

    params = {'hub.mode': 'subscribe', 'hub.verify_token': env['META_MESSAGING_VERIFY_TOKEN'], 'hub.challenge': marker}
    result = requests.get(base + '/functions/v1/meta-messaging-webhook', params=params, timeout=30)
    check('Meta verifies subscription challenge', result.status_code == 200 and result.text == marker)
    result = requests.get(base + '/functions/v1/meta-messaging-webhook', params={**params, 'hub.verify_token': 'wrong'}, timeout=30)
    check('Meta rejects wrong verify token', result.status_code == 403)
    payload = json.dumps({'object': 'whatsapp_business_account', 'entry': [], 'rhi_uat_fixture': marker})
    check('Meta rejects missing signature', post('meta-messaging-webhook', payload).status_code == 401)
    result = post('meta-messaging-webhook', payload, {'x-hub-signature-256': 'sha256=' + sign(env['META_APP_SECRET'], payload)})
    check('Meta accepts signed empty event', result.status_code == 200 and result.json().get('success'))
    with db, db.cursor() as cur:
        cur.execute("select count(*) from public.kv_store_f781cd00 where value->'payload'->>'rhi_uat_fixture'=%s", (marker,))
        check('Both signed event records persisted', cur.fetchone()[0] == 2)
    passed = True
finally:
    with db, db.cursor() as cur:
        cur.execute("delete from public.kv_store_f781cd00 where value->'payload'->>'rhi_uat_fixture'=%s or key=%s",
            (marker, 'kirimdev_messaging_dedup:' + marker))
        cur.execute("select count(*) from public.kv_store_f781cd00 where value->'payload'->>'rhi_uat_fixture'=%s or key=%s",
            (marker, 'kirimdev_messaging_dedup:' + marker))
        assert cur.fetchone()[0] == 0, 'Fixture cleanup failed'
    db.close()
    (root / 'webhook-verification.json').write_text(json.dumps({'passed': passed, 'checks': checks,
        'fixtures_cleaned': True, 'live_provider_delivery_tested': False, 'outbound_messages_sent': False}, indent=2))
