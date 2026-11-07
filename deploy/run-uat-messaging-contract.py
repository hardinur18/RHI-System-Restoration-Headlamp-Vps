#!/usr/bin/env python3
"""Run messaging contracts with a private fake provider and restore UAT routing.

Starts a second worker with the same bundles on the existing internal-only UAT
network. Production and public preview containers/configuration are untouched.
"""
import fcntl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import subprocess
import threading

assert socket.gethostname().split('.')[0] == 'srv2126686' and os.geteuid() == 0
os.umask(0o077)
root = Path('/opt/rhi/uat-20261106')
lock = open('/run/lock/rhi-uat-messaging-contract.lock', 'w')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
assert not (root / 'kirimdev-prospects-fixture.json').exists()
inspect = lambda name: json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]
worker = inspect('rhi-uat-functions')
network = worker['HostConfig']['NetworkMode']
assert network == 'rhi_uat_isolated'
net = json.loads(subprocess.check_output(['docker', 'network', 'inspect', network]))[0]
assert net['Internal']
gateway_ip = net['IPAM']['Config'][0]['Gateway']
subnet = net['IPAM']['Config'][0]['Subnet']
assert gateway_ip == '172.30.45.1' and subnet == '172.30.45.0/24'
bridge = net.get('Options', {}).get('com.docker.network.bridge.name') or 'br-' + net['Id'][:12]
firewall_rule = ['allow', 'in', 'on', bridge, 'proto', 'tcp', 'from', subnet,
                 'to', gateway_ip, 'port', '18889']
assert '18889' not in subprocess.check_output(['ufw', 'show', 'added'], text=True), 'Do not replace an existing firewall rule'
environment = dict(value.split('=', 1) for value in worker['Config']['Env'])
assert environment['KIRIMDEV_API_KEY'].startswith('uat-only-')
environment['KIRIMDEV_API_BASE_URL'] = 'http://rhi-uat-gateway:8080/__rhi/kirimdev-mock'
environment['KIRIMDEV_DISPLAY_PHONE_NUMBER'] = ''
config = root / 'gateway.conf'
before = config.read_text()
assert 'rhi-uat-functions:9000' in before and '__rhi/kirimdev-mock' not in before
backup = root / 'gateway.before-messaging-contract.conf'
assert not backup.exists(), 'Review and restore an interrupted run first'
env_path = root / 'messaging-contract.env'
assert not env_path.exists(), 'Review credentials left by an interrupted run first'
env_path.write_text('\n'.join(key + '=' + value for key, value in environment.items()) + '\n')
requests_seen = []
response_by_key = {}


class Provider(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        if length > 10000:
            self.send_error(413)
            return
        body = json.loads(self.rfile.read(length))
        key = self.headers.get('Idempotency-Key', '')
        text = body.get('text', {}).get('body', '')
        if (self.headers.get('Authorization') != 'Bearer ' + environment['KIRIMDEV_API_KEY']
                or not key.startswith('rhi-uat-kirimdev-') or not text.startswith('rhi-uat-kirimdev-')
                or not self.path.endswith('/messages') or body.get('type') != 'text'):
            self.send_error(403)
            return
        requests_seen.append({'path': self.path, 'idempotency_key': key, 'body': body})
        (root / 'messaging-contract-requests.json').write_text(json.dumps(requests_seen))
        failed = text.endswith('simulate-failure')
        payload = {'error': {'message': 'Synthetic provider failure'}} if failed else response_by_key.setdefault(
            key, {'data': {'id': key + '-provider', 'status': 'sent'}})
        encoded = json.dumps(payload).encode()
        self.send_response(503 if failed else 200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


server = ThreadingHTTPServer((gateway_ip, 18889), Provider)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
name = 'rhi-uat-functions-messaging-contract'
started = False
changed = False
firewall_opened = False
try:
    # Only the isolated bridge can reach this host-bound fake provider. This
    # rule never permits public traffic and is removed in the outermost cleanup.
    subprocess.run(['ufw', *firewall_rule], check=True, stdout=subprocess.DEVNULL)
    firewall_opened = True
    command = ['docker', 'run', '--detach', '--name', name, '--network', network, '--env-file', str(env_path)]
    for mount in worker['Mounts']:
        assert Path(mount['Source']).is_relative_to(root)
        command.extend(['-v', mount['Source'] + ':' + mount['Destination'] + (':ro' if not mount['RW'] else '')])
    command.extend([worker['Config']['Image'], *worker['Config']['Cmd']])
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL)
    started = True
    backup.write_text(before)
    changed = True
    mock_location = '        location /__rhi/kirimdev-mock/ { proxy_pass http://' + gateway_ip + ':18889/; }\n'
    config.write_text(before.replace('rhi-uat-functions:9000', name + ':9000').replace(
        '        location /auth/v1/', mock_location + '        location /auth/v1/'))
    subprocess.run(['docker', 'exec', 'rhi-uat-gateway', 'nginx', '-t'], check=True, capture_output=True)
    subprocess.run(['docker', 'exec', 'rhi-uat-gateway', 'nginx', '-s', 'reload'], check=True, capture_output=True)
    subprocess.run(['python3', '/opt/rhi/migration/test-uat-kirimdev-prospects.py'],
                   env={**os.environ, 'RHI_UAT_MOCK_PROVIDER': '1'}, check=True)
finally:
    try:
        if changed:
            config.write_text(before)
            subprocess.run(['docker', 'exec', 'rhi-uat-gateway', 'nginx', '-t'], check=True, capture_output=True)
            subprocess.run(['docker', 'exec', 'rhi-uat-gateway', 'nginx', '-s', 'reload'], check=True, capture_output=True)
            backup.unlink()
    finally:
        try:
            if started:
                subprocess.run(['docker', 'rm', '-f', name], check=True, stdout=subprocess.DEVNULL)
        finally:
            if firewall_opened:
                subprocess.run(['ufw', 'delete', *firewall_rule], check=True, stdout=subprocess.DEVNULL)
            server.shutdown()
            server.server_close()
            env_path.unlink()
    assert config.read_text() == before
print('Private provider contract finished; original UAT gateway restored; no external messages sent.')
