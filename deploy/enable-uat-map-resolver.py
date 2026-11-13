#!/usr/bin/env python3
"""Give the disposable UAT function runtime egress only to Google Maps hosts."""

import datetime
import json
import os
from pathlib import Path
import socket
import subprocess


NAME = 'rhi-uat-functions'
INTERNAL_NETWORK = 'rhi_uat_isolated'
EGRESS_NETWORK = 'supabase_function_egress'
ROOT = Path('/opt/rhi/uat-20261106')
ALLOWED = ','.join((
    'maps.app.goo.gl:443',
    'www.google.com:443',
    'maps.google.com:443',
    'google.com:443',
    'goo.gl:443',
))


def output(*args):
    return subprocess.check_output(args, text=True)


def run(*args):
    subprocess.run(args, check=True)


assert os.geteuid() == 0 and socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup_name = f'{NAME}-before-maps-{stamp.lower()}'
inspect = json.loads(output('docker', 'inspect', NAME))[0]
assert inspect['Config']['Labels'].get('rhi.purpose') == 'disposable-uat'
assert set(inspect['NetworkSettings']['Networks']) in ({INTERNAL_NETWORK}, {INTERNAL_NETWORK, EGRESS_NETWORK})
assert inspect['Config']['Image'] == 'supabase/edge-runtime:v1.77.4'

(ROOT / f'{backup_name}.inspect.json').write_text(json.dumps(inspect, indent=2) + '\n')
env = dict(item.split('=', 1) for item in inspect['Config']['Env'])
env['RHI_STAGING_ALLOWED_NETWORKS'] = ALLOWED
env_path = ROOT / f'{NAME}.env'
env_path.write_text('\n'.join(f'{key}={value}' for key, value in env.items()) + '\n')

bind_args = [item for bind in inspect['HostConfig']['Binds'] for item in ('-v', bind)]
command = [
    'docker', 'run', '-d', '--name', NAME, '--network', INTERNAL_NETWORK,
    '--env-file', str(env_path), '--label', 'rhi.purpose=disposable-uat',
    *bind_args, inspect['Config']['Image'], *inspect['Config']['Cmd'],
]

run('docker', 'stop', NAME)
run('docker', 'rename', NAME, backup_name)
try:
    run(*command)
    run('docker', 'network', 'connect', EGRESS_NETWORK, NAME)
    run('docker', 'exec', 'rhi-uat-gateway', 'nginx', '-t')
    run('docker', 'exec', 'rhi-uat-gateway', 'nginx', '-s', 'reload')
    current = json.loads(output('docker', 'inspect', NAME))[0]
    assert set(current['NetworkSettings']['Networks']) == {INTERNAL_NETWORK, EGRESS_NETWORK}
    current_env = dict(item.split('=', 1) for item in current['Config']['Env'])
    assert current_env['RHI_STAGING_ALLOWED_NETWORKS'] == ALLOWED
except Exception:
    subprocess.run(['docker', 'rm', '-f', NAME], check=False)
    run('docker', 'rename', backup_name, NAME)
    run('docker', 'start', NAME)
    run('docker', 'exec', 'rhi-uat-gateway', 'nginx', '-s', 'reload')
    raise

print(json.dumps({'state': 'enabled-needs-smoke', 'backup_container': backup_name,
                  'allowed_networks': ALLOWED.split(',')}))
