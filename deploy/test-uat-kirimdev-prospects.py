#!/usr/bin/env python3
"""Exercise signed Kirimdev messages through the deployed UAT worker into Prospek.

Synthetic inbound/ack events only. No provider API or outbound messages. All
fixtures are unique, recorded before use, and removed from the isolated database.
"""
import datetime
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket
import time
import uuid

import requests

assert socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
root = Path('/opt/rhi/uat-20261106')
base = 'http://127.0.0.1:18080'
marker_response = requests.get(base + '/__rhi/uat', timeout=10).json()
assert marker_response['database'] == 'rhi_uat_20261106' and not marker_response['provider_delivery']
env = dict(line.split('=', 1) for line in (root / 'rhi-uat-functions.env').read_text().splitlines() if '=' in line)
assert env['KIRIMDEV_WEBHOOK_SECRET'].startswith('uat-only-')
assert env['META_APP_SECRET'].startswith('uat-only-')
keys = json.loads((root / 'keys.json').read_text())
admin = {'apikey': keys['SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + keys['SERVICE_ROLE_KEY']}
anon = {'apikey': keys['ANON_KEY'], 'Authorization': 'Bearer ' + keys['ANON_KEY']}
spec = importlib.util.spec_from_file_location('delta', '/opt/rhi/migration/plan-delta.py')
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)
db = delta.connection_target(admin=True, database='rhi_uat_20261106')
with db, db.cursor() as cur:
    cur.execute('select current_database()')
    assert cur.fetchone()[0] == 'rhi_uat_20261106'
marker = 'rhi-uat-kirimdev-' + uuid.uuid4().hex
fixture = root / 'kirimdev-prospects-fixture.json'
assert not fixture.exists(), 'Inspect and clean the preceding fixture before retrying'
state = {'marker': marker, 'users': [], 'channels': [], 'events': []}
fixture.write_text(json.dumps(state))
checks = []
passed = False


def save():
    fixture.write_text(json.dumps(state, indent=2))


def check(name, condition):
    assert condition, name
    checks.append(name)
    print('PASS ' + name, flush=True)


def request(method, path, headers=None, **kwargs):
    return requests.request(method, base + path, headers=headers or admin, timeout=90, **kwargs)


def call(method, path, headers=None, **kwargs):
    response = request(method, path, headers, **kwargs)
    if not response.ok:
        (root / 'kirimdev-prospects-error.json').write_text(json.dumps({
            'path': path, 'status': response.status_code, 'response': response.text}))
    assert response.ok, (method, path, response.status_code)
    return response.json() if response.content else None


def create(role, number):
    email, password = marker + '-' + role.lower() + '@example.invalid', secrets.token_urlsafe(32)
    result = call('POST', '/auth/v1/admin/users', json={'email': email, 'password': password,
        'email_confirm': True, 'user_metadata': {'name': marker, 'role': role}})
    user_id = (result.get('user') or result)['id']
    state['users'].append(user_id)
    save()
    call('POST', '/rest/v1/profiles', {**admin, 'Prefer': 'resolution=merge-duplicates'}, json={
        'id': user_id, 'email': email, 'name': marker, 'role': role, 'status': 'active',
        'employment_status': 'permanent', 'cs_whatsapp_number': number})
    token = call('POST', '/auth/v1/token?grant_type=password', anon,
                 json={'email': email, 'password': password})['access_token']
    return user_id, {**anon, 'Authorization': 'Bearer ' + token, 'x-client-token': token}


def deliver(payload, event_id):
    if event_id not in state['events']:
        state['events'].append(event_id)
        save()
    body = json.dumps({**payload, 'rhi_uat_fixture': marker}, separators=(',', ':'))
    timestamp = str(int(time.time()))
    signature = hmac.new(env['KIRIMDEV_WEBHOOK_SECRET'].encode(),
                         (timestamp + '.' + body).encode(), hashlib.sha256).hexdigest()
    response = request('POST', '/functions/v1/kirimdev-messaging-webhook', {
        'Content-Type': 'application/json', 'x-kirim-event-id': event_id,
        'x-kirim-signature': 't=' + timestamp + ',v1=' + signature}, data=body)
    assert response.status_code == 200, ('signed event', response.status_code)
    return response.json()


def lead_rows():
    with db, db.cursor() as cur:
        cur.execute('select id,phone,status,cs_id::text,origin from public.leads where name=%s', (marker,))
        return cur.fetchall()


try:
    suffix = str(secrets.randbelow(90000000) + 10000000)
    receiver, customer = '62899' + suffix, '62898' + suffix
    with db, db.cursor() as cur:
        cur.execute('select count(*) from public.profiles where cs_whatsapp_number=%s or phone=%s', (receiver, receiver))
        assert cur.fetchone()[0] == 0
        cur.execute('select count(*) from public.leads where phone=ANY(%s)', ([customer, '0' + customer[2:]],))
        assert cur.fetchone()[0] == 0
    owner_id, owner = create('Owner', None)
    cs_id, cs = create('CS', receiver)
    phone_id = marker + '-phone'
    channel = 'whatsapp:' + phone_id
    conversation = channel + ':' + customer
    state['channels'].append(channel)
    save()
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    payload = {'id': marker + '-event-1', 'type': 'message.received', 'created_at': now, 'data': {
        'meta': {'phone_number_id': phone_id, 'display_phone_number': receiver},
        'contact': {'phone_number': customer, 'name': marker},
        'message': {'id': marker + '-message-1', 'type': 'text', 'body': marker + ' inbound', 'timestamp': now}}}
    result = deliver(payload, marker + '-event-1')
    check('Signed incoming chat accepted', result.get('success') is True)
    leads = lead_rows()
    check('Incoming chat creates exactly one Pending Prospek', len(leads) == 1 and leads[0][2] == 'Pending')
    check('Prospek assigned to CS matching receiving WhatsApp number', leads[0][3] == cs_id)
    check('Prospek retains automatic WhatsApp origin and normalized customer phone',
          leads[0][4] == 'auto_wa_api' and leads[0][1] == '0' + customer[2:])
    with db, db.cursor() as cur:
        cur.execute('select count(*) from public.whatsapp_messages where conversation_id=%s and direction=%s', (conversation, 'inbound'))
        check('Inbound chat stored in relational message table', cur.fetchone()[0] == 1)
        cur.execute('select count(*) from public.whatsapp_conversations where id=%s', (conversation,))
        check('Conversation stored', cur.fetchone()[0] == 1)
        cur.execute('select count(*) from public.whatsapp_contacts where channel_id=%s', (channel,))
        check('WhatsApp contact stored', cur.fetchone()[0] == 1)
    result = deliver(payload, marker + '-event-1')
    check('Repeated delivery deduplicated', result.get('duplicate') is True)
    check('Repeated delivery creates no additional Prospek', len(lead_rows()) == 1)
    payload['id'] = marker + '-event-2'
    payload['data']['message']['id'] = marker + '-message-2'
    payload['data']['message']['body'] = marker + ' second inbound'
    deliver(payload, marker + '-event-2')
    check('Second chat from same customer/CS creates no duplicate open Prospek', len(lead_rows()) == 1)
    result = call('GET', '/functions/v1/make-server-f781cd00/meta/messaging/whatsapp/messages', owner,
                  params={'conversationId': conversation, 'sync': 'false'})
    check('Application API returns both incoming chat messages',
          len([m for m in result.get('messages', []) if marker in json.dumps(m)]) == 2)
    # A delivery acknowledgement is a synthetic provider event, not a send call.
    payload['id'] = marker + '-event-3'
    payload['type'] = 'message.sent'
    payload['data']['message']['id'] = marker + '-message-3'
    payload['data']['message']['to'] = customer
    payload['data']['message']['body'] = marker + ' synthetic outbound acknowledgement'
    deliver(payload, marker + '-event-3')
    with db, db.cursor() as cur:
        cur.execute('select count(*) from public.whatsapp_messages where conversation_id=%s and direction=%s', (conversation, 'outbound'))
        check('Outbound acknowledgement stays in the same conversation', cur.fetchone()[0] == 1)
    check('Outbound acknowledgement creates no new Prospek', len(lead_rows()) == 1)
    # Current source traffic is recorded as Meta/webhook, so prove that path too.
    meta_customer = '62897' + suffix
    with db, db.cursor() as cur:
        cur.execute('select count(*) from public.leads where phone=ANY(%s)',
                    ([meta_customer, '0' + meta_customer[2:]],))
        assert cur.fetchone()[0] == 0
    meta_payload = {'object': 'whatsapp_business_account', 'rhi_uat_fixture': marker, 'entry': [{
        'id': marker + '-waba', 'changes': [{'field': 'messages', 'value': {
            'messaging_product': 'whatsapp',
            'metadata': {'phone_number_id': phone_id, 'display_phone_number': receiver},
            'contacts': [{'wa_id': meta_customer, 'profile': {'name': marker}}],
            'messages': [{'from': meta_customer, 'id': marker + '-meta-message',
                          'timestamp': str(int(time.time())), 'type': 'text', 'text': {'body': marker + ' Meta inbound'}}],
        }}]}]}
    meta_body = json.dumps(meta_payload)
    meta_headers = {'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=' +
                    hmac.new(env['META_APP_SECRET'].encode(), meta_body.encode(), hashlib.sha256).hexdigest()}
    response = request('POST', '/functions/v1/meta-messaging-webhook', meta_headers, data=meta_body)
    check('Active source Meta webhook format accepted', response.status_code == 200 and response.json().get('success'))
    meta_leads = [row for row in lead_rows() if row[1] == '0' + meta_customer[2:]]
    check('Meta inbound creates Pending Prospek for the same mapped CS',
          len(meta_leads) == 1 and meta_leads[0][2:5] == ('Pending', cs_id, 'auto_wa_api'))
    response = request('POST', '/functions/v1/meta-messaging-webhook', meta_headers, data=meta_body)
    check('Repeated Meta notification does not duplicate Prospek', response.ok and len(lead_rows()) == 2)
    result = call('GET', '/functions/v1/make-server-f781cd00/meta/messaging/whatsapp/messages', owner,
                  params={'conversationId': channel + ':' + meta_customer, 'sync': 'false'})
    check('Application API returns one Meta message after repeated notification',
          len([m for m in result.get('messages', []) if m.get('id') == marker + '-meta-message']) == 1)
    if os.environ.get('RHI_UAT_MOCK_PROVIDER') == '1':
        send_path = '/functions/v1/make-server-f781cd00/meta/messaging/whatsapp/send'
        reply = {'conversationId': conversation, 'text': marker + ' reply',
                 'replyToMessageId': marker + '-message-1', 'idempotencyKey': marker + '-reply'}
        check('Anonymous reply denied', request('POST', send_path, anon, json=reply).status_code in (401, 403))
        result = call('POST', send_path, owner, json=reply)
        check('Application reply reaches isolated fake provider', result.get('success') and result.get('provider') == 'kirimdev')
        recorded = json.loads((root / 'messaging-contract-requests.json').read_text())[-1]
        check('Reply preserves destination, text, reply context and idempotency key',
              recorded['body']['to'] == customer and recorded['body']['text']['body'] == reply['text']
              and recorded['body']['context']['message_id'] == marker + '-message-1'
              and recorded['idempotency_key'] == reply['idempotencyKey'])
        call('POST', send_path, owner, json=reply)
        with db, db.cursor() as cur:
            cur.execute('select count(*) from public.whatsapp_messages where conversation_id=%s and id=%s',
                        (conversation, marker + '-reply-provider'))
            check('Repeated provider response persists one reply message', cur.fetchone()[0] == 1)
        failure = request('POST', send_path, owner,
                          json={**reply, 'text': marker + ' simulate-failure', 'idempotencyKey': marker + '-failed'})
        check('Upstream send failure surfaces as application failure', failure.status_code == 500)
        with db, db.cursor() as cur:
            cur.execute('select count(*) from public.whatsapp_messages where conversation_id=%s and text=%s',
                        (conversation, marker + ' simulate-failure'))
            check('Failed send is not saved as a successful message', cur.fetchone()[0] == 0)
        check('Sending replies does not create extra Prospek', len(lead_rows()) == 2)
    passed = True
finally:
    with db, db.cursor() as cur:
        cur.execute('delete from public.leads where name=%s', (marker,))
        for table in ['whatsapp_messages', 'whatsapp_contacts', 'whatsapp_conversations']:
            cur.execute('delete from public.' + table + ' where channel_id=ANY(%s)', (state['channels'],))
        cur.execute('delete from public.kv_store_f781cd00 where position(%s in key)>0 or '
                    'value->\'payload\'->>\'rhi_uat_fixture\'=%s', (marker, marker))
        cur.execute("delete from public.kv_store_f781cd00 where key like 'audit:%%' and value->>'user'=%s", (marker,))
    for user_id in state['users']:
        call('DELETE', '/rest/v1/profiles?id=eq.' + user_id)
        call('DELETE', '/auth/v1/admin/users/' + user_id)
    with db, db.cursor() as cur:
        for table in ['leads', 'profiles', 'whatsapp_messages', 'whatsapp_contacts', 'whatsapp_conversations', 'kv_store_f781cd00']:
            cur.execute('select count(*) from public.' + table + ' t where position(%s in to_jsonb(t)::text)>0', (marker,))
            assert cur.fetchone()[0] == 0, 'Fixture left in ' + table
    db.close()
    fixture.unlink()
    (root / 'kirimdev-prospects-verification.json').write_text(json.dumps({
        'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'passed': passed,
        'checks': checks, 'fixtures_cleaned': True, 'live_provider_delivery_tested': False,
        'mock_outbound_contract_tested': os.environ.get('RHI_UAT_MOCK_PROVIDER') == '1',
        'outbound_messages_sent': False, 'scope': 'signed synthetic messages through isolated deployed UAT worker'}, indent=2))

assert passed
