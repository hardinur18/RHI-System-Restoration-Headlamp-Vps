#!/usr/bin/env python3
"""Exercise captured SMTP recovery/invite and the app's admin password reset.

Requires compose.mail-test.yml. Every recipient is a generated example.invalid
fixture. Mailpit has no external route or relay. No token/password is printed.
"""
import html
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import time
from urllib.parse import urlsplit, parse_qs
import uuid
import requests

assert socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
work = Path('/opt/rhi/migration')
env = dict(line.split('=', 1) for line in Path('/opt/rhi/supabase/.env').read_text().splitlines()
           if '=' in line and not line.startswith('#'))
auth_container = json.loads(subprocess.check_output(['docker', 'inspect', 'supabase-auth']))[0]
auth_env = dict(v.split('=', 1) for v in auth_container['Config']['Env'])
assert auth_env['GOTRUE_SMTP_HOST'] == 'mail-test' and auth_env['GOTRUE_SMTP_PORT'] == '1025'
mail_container = json.loads(subprocess.check_output(['docker', 'inspect', 'rhi-mail-test']))[0]
assert not any('RELAY' in value for value in mail_container['Config']['Env'])
resolve = socket.getaddrinfo
socket.getaddrinfo = lambda host, *args, **kwargs: resolve(
    '127.0.0.1' if host == 'api-rhi.polesheadlamp.id' else host, *args, **kwargs)
base = 'https://api-rhi.polesheadlamp.id'
mail_ip = next(iter(mail_container['NetworkSettings']['Networks'].values()))['IPAddress']
mail = 'http://' + mail_ip + ':8025'
admin = {'apikey': env['SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + env['SERVICE_ROLE_KEY']}
anon = {'apikey': env['ANON_KEY'], 'Authorization': 'Bearer ' + env['ANON_KEY']}
fixtures = []
message_ids = []
checks = []


def call(method, path, headers=None, **kwargs):
    return requests.request(method, base + path, headers=headers or anon, timeout=45, **kwargs)


def check_response(response, expected=200):
    assert response.status_code == expected, 'Unexpected response status ' + str(response.status_code)
    return response


def login(account, password=None):
    response = call('POST', '/auth/v1/token?grant_type=password', json={
        'email': account['email'], 'password': password or account['password']})
    return check_response(response).json()['access_token']


def create(role):
    account = {'email': 'rhi-mail-test-' + uuid.uuid4().hex + '@example.invalid',
               'password': secrets.token_urlsafe(32), 'role': role}
    response = call('POST', '/auth/v1/admin/users', admin, json={
        'email': account['email'], 'password': account['password'], 'email_confirm': True,
        'user_metadata': {'name': 'Migration mail test ' + role, 'role': role}})
    result = check_response(response).json()
    account['id'] = (result.get('user') or result)['id']
    fixtures.append(account)
    (work / 'mail-test-fixtures.json').write_text(json.dumps(fixtures))
    response = call('POST', '/rest/v1/profiles', {**admin, 'Prefer': 'resolution=merge-duplicates'}, json={
        'id': account['id'], 'email': account['email'], 'name': 'Migration mail test ' + role,
        'role': role, 'status': 'active', 'branch_id': None, 'employment_status': 'permanent'})
    assert response.ok
    return account


def captured_link(email, kind):
    for _ in range(20):
        response = requests.get(mail + '/api/v1/messages', timeout=10)
        response.raise_for_status()
        for message in response.json()['messages']:
            if any(recipient['Address'] == email for recipient in message['To']):
                full = requests.get(mail + '/api/v1/message/' + message['ID'], timeout=10).json()
                if message['ID'] not in message_ids:
                    message_ids.append(message['ID'])
                for link in re.findall(r'href=["\']([^"\']+)', full['HTML']):
                    link = html.unescape(link)
                    parsed = urlsplit(link)
                    if parse_qs(parsed.query).get('type') == [kind]:
                        assert parsed.scheme == 'https' and parsed.netloc == 'api-rhi.polesheadlamp.id'
                        assert parsed.path == '/auth/v1/verify'
                        assert parse_qs(parsed.query)['redirect_to'][0].startswith('https://rhi.polesheadlamp.id/')
                        return link
        time.sleep(0.5)
    raise AssertionError('Expected message was not captured')


def redeem(link):
    response = requests.get(link, allow_redirects=False, timeout=30)
    assert response.status_code in (302, 303)
    target = urlsplit(response.headers['Location'])
    assert target.netloc == 'rhi.polesheadlamp.id'
    fragment = parse_qs(target.fragment)
    assert 'access_token' in fragment, 'Email link did not establish session'
    return fragment['access_token'][0]


try:
    owner, member = create('Owner'), create('CS')
    # Password recovery is verified end-to-end through SMTP capture, not merely
    # by generating a link through an administrative API.
    response = call('POST', '/auth/v1/recover?redirect_to=https%3A%2F%2Frhi.polesheadlamp.id%2Flogin%2F',
                    json={'email': member['email']})
    check_response(response)
    link = captured_link(member['email'], 'recovery')
    token = redeem(link)
    replacement = secrets.token_urlsafe(32)
    check_response(call('PUT', '/auth/v1/user', {**anon, 'Authorization': 'Bearer ' + token},
                        json={'password': replacement}))
    assert call('POST', '/auth/v1/token?grant_type=password', json={
        'email': member['email'], 'password': member['password']}).status_code == 400
    member['password'] = replacement
    login(member)
    replay = requests.get(link, allow_redirects=False, timeout=30)
    assert 'access_token=' not in replay.headers.get('Location', '')
    checks.append({'check': 'captured_recovery_change_password_single_use', 'passed': True})

    invite_email = 'rhi-mail-test-' + uuid.uuid4().hex + '@example.invalid'
    response = check_response(call('POST', '/auth/v1/invite?redirect_to=https%3A%2F%2Frhi.polesheadlamp.id%2Flogin%2F',
        admin, json={'email': invite_email}))
    result = response.json()
    invite = {'id': (result.get('user') or result)['id'], 'email': invite_email,
              'password': secrets.token_urlsafe(32), 'role': 'Invite fixture'}
    fixtures.append(invite)
    (work / 'mail-test-fixtures.json').write_text(json.dumps(fixtures))
    token = redeem(captured_link(invite_email, 'invite'))
    check_response(call('PUT', '/auth/v1/user', {**anon, 'Authorization': 'Bearer ' + token},
                        json={'password': invite['password']}))
    login(invite)
    checks.append({'check': 'captured_invite_accept_set_password_login', 'passed': True})

    # Existing application workflow: admins reset directly; no SMTP needed.
    endpoint = '/functions/v1/make-server-f781cd00/users/' + member['id'] + '/password'
    new_password = secrets.token_urlsafe(32)
    assert call('PUT', endpoint, json={'password': new_password}).status_code == 401
    member_token = login(member)
    assert call('PUT', endpoint, {**anon, 'Authorization': 'Bearer ' + member_token,
        'x-client-token': member_token}, json={'password': new_password}).status_code == 403
    owner_token = login(owner)
    check_response(call('PUT', endpoint, {**anon, 'Authorization': 'Bearer ' + owner_token,
        'x-client-token': owner_token}, json={'password': new_password}))
    assert call('POST', '/auth/v1/token?grant_type=password', json={
        'email': member['email'], 'password': member['password']}).status_code == 400
    login(member, new_password)
    checks.append({'check': 'admin_password_reset_and_unauthorized_denial', 'passed': True})
finally:
    failures = []
    for account in fixtures:
        try:
            assert account['email'].startswith('rhi-mail-test-') and account['email'].endswith('@example.invalid')
            user_id = str(uuid.UUID(account['id']))
            assert call('DELETE', '/rest/v1/profiles?id=eq.' + user_id, admin).ok
            response = call('DELETE', '/auth/v1/admin/users/' + user_id, admin)
            assert response.ok or response.status_code == 404
        except Exception:
            failures.append(account['id'])
    if not failures:
        (work / 'mail-test-fixtures.json').unlink(missing_ok=True)
    # Only delete messages belonging to fixtures created by this run.
    if message_ids:
        response = requests.delete(mail + '/api/v1/messages', json={'IDs': message_ids}, timeout=15)
        assert response.ok
    (work / 'mail-and-reset-verification.json').write_text(json.dumps({
        'external_delivery_tested': False, 'checks': checks, 'fixture_cleanup_failures': failures}, indent=2))
    assert not failures, 'Fixture cleanup requires attention'
print(json.dumps({'checks_passed': len(checks), 'external_email_sent': False, 'fixtures_removed': len(fixtures)}))
