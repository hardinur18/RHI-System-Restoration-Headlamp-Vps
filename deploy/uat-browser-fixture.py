#!/usr/bin/env python3
"""Create/remove one disposable browser test login on the private UAT API."""
import argparse
import json
import os
from pathlib import Path
import secrets
import socket
import uuid
import requests

assert socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('action', choices=['prepare', 'cleanup'])
args = parser.parse_args()
root = Path('/opt/rhi/uat-20261106')
file = root / 'browser-fixture.json'
keys = json.loads((root / 'keys.json').read_text())
headers = {'apikey': keys['SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + keys['SERVICE_ROLE_KEY']}
base = 'http://127.0.0.1:18080'
def request(method, path, **kwargs):
    result = requests.request(method, base + path, headers=headers, timeout=30, **kwargs)
    assert result.ok, (method, path, result.status_code)
    return result.json() if result.content else None
if args.action == 'prepare':
    assert not file.exists(), 'Remove previous fixture first'
    state = {'email': 'rhi-browser-' + uuid.uuid4().hex + '@example.invalid',
        'password': secrets.token_urlsafe(32)}
    user = request('POST', '/auth/v1/admin/users', json={**state, 'email_confirm': True,
        'user_metadata': {'name': 'RHI UAT Test', 'role': 'Owner'}})
    state['id'] = (user.get('user') or user)['id']
    file.write_text(json.dumps(state))
    request('POST', '/rest/v1/profiles', json={'id': state['id'], 'email': state['email'],
        'name': 'RHI UAT Test', 'role': 'Owner', 'status': 'active', 'employment_status': 'permanent'})
    print('Private browser test login prepared')
else:
    state = json.loads(file.read_text())
    assert state['email'].startswith('rhi-browser-') and state['email'].endswith('@example.invalid')
    request('DELETE', '/rest/v1/profiles?id=eq.' + str(uuid.UUID(state['id'])))
    request('DELETE', '/auth/v1/admin/users/' + str(uuid.UUID(state['id'])))
    file.unlink()
    print('Private browser login and sessions removed')
