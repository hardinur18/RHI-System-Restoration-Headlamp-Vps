#!/usr/bin/env python3
"""Promote a checked frontend candidate only while the VPS remains read-only."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import requests

assert os.geteuid() == 0 and socket.gethostname().split('.')[0] == 'srv2126686'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('candidate')
parser.add_argument('--external-proof', required=True,
                    help='Fresh Mac-side HTTP fence receipt copied into /opt/rhi/migration')
args = parser.parse_args()
candidate = Path(args.candidate).resolve()
assert candidate.parent == Path('/var/www/rhi/releases') and candidate.name.startswith('preview-')
manifest = json.loads((candidate / 'release.json').read_text())
assert manifest['read_only'] is True and re.fullmatch(r'[0-9a-f]{40}', manifest['commit'])
for name, expected in manifest['files'].items():
    file = candidate / name
    assert file.resolve().is_relative_to(candidate) and file.is_file() and not file.is_symlink()
    assert hashlib.sha256(file.read_bytes()).hexdigest() == expected, 'Candidate checksum mismatch'
assert {str(p.relative_to(candidate)) for p in candidate.rglob('*') if p.is_file()} == set(manifest['files']) | {'release.json'}
subprocess.run(['python3', '/opt/rhi/migration/check-release-infrastructure.py'], check=True, stdout=subprocess.DEVNULL)
infrastructure = json.loads(Path('/opt/rhi/migration/release-infrastructure.json').read_text())
assert infrastructure['preview_infrastructure_healthy'], 'Preview isolation or infrastructure check failed'
api = 'https://api-rhi.polesheadlamp.id'
# This VPS is intentionally exempt from Nginx's external fence. An actual
# outside client must verify it; treating its internal 401 as proof is wrong.
proof_path = Path(args.external_proof).resolve()
assert proof_path.parent == Path('/opt/rhi/migration')
proof = json.loads(proof_path.read_text())
assert proof['commit'] == manifest['commit'] and proof['api'] == api
proof_age = (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(proof['checked_at'])).total_seconds()
assert 0 <= proof_age < 300 and proof['write_status'] == 409 and proof['webhook_status'] == 503
ingress_before = subprocess.check_output(['nginx', '-T'], stderr=subprocess.DEVNULL)
assert requests.get(api + '/functions/v1/kirimdev-messaging-webhook', timeout=20).status_code == 503
current = Path('/var/www/rhi/current')
assert current.is_symlink()
previous = current.resolve()
assert previous.parent == candidate.parent and previous != candidate
subprocess.run(['python3', '/opt/rhi/migration/retain-preview-assets.py', str(previous)], check=True)
temporary = current.with_name('candidate-link')
assert not temporary.exists() and not temporary.is_symlink()

def point_to(target):
    temporary.symlink_to(target)
    temporary.replace(current)

point_to(candidate)
try:
    response = requests.get('https://rhi.polesheadlamp.id/', timeout=30)
    assert response.status_code == 200
    assert hashlib.sha256(response.content).hexdigest() == manifest['files']['index.html']
    for route in ['/login/', '/monitoring/field', '/ads/monitoring/advertiser-matrix']:
        response = requests.get('https://rhi.polesheadlamp.id' + route, timeout=30)
        assert response.status_code == 200 and hashlib.sha256(response.content).hexdigest() == manifest['files']['index.html']
    assert subprocess.check_output(['nginx', '-T'], stderr=subprocess.DEVNULL) == ingress_before
except Exception:
    point_to(previous)
    raise
report = {'promoted_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'commit': manifest['commit'], 'release': str(candidate), 'rollback_release': str(previous),
          'public_html_verified': True, 'read_only_preserved': True, 'external_precheck_verified': True,
          'external_postcheck_required': True, 'source_changed': False, 'cutover': False}
Path('/opt/rhi/migration/frontend-preview-promotion.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
