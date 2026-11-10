#!/usr/bin/env python3
"""Rehearse the pinned Ads-scope bundle on isolated UAT and restore its baseline."""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess

assert socket.gethostname().split('.')[0] == 'srv2126686' and os.geteuid() == 0
os.umask(0o077)
root = Path('/opt/rhi/uat-20261106')
lock = open('/run/lock/rhi-uat-scoped-bundle.lock', 'w')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
assert not list(root.glob('*fixture.json')) and not list(root.glob('*fixtures.json'))
candidate = root / 'make-server-f781cd00-scoped.eszip'
receipt = json.loads(candidate.with_suffix('.receipt.json').read_text())
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert receipt['official_parser_verified'] and receipt['all_module_bytes_and_maps_verified']
assert receipt['original_sha256'] == 'ca077a4176b2709fe257eddfc5c8efdf9c90bc39450340593901e6c6b8354ea2'
assert receipt['patched_sha256'] == 'd9c363872744194269d3eff5be4255a108e10f95297299034ddb32c1e882b071'
assert digest(candidate) == receipt['patched_sha256']
worker = json.loads(subprocess.check_output(['docker', 'inspect', 'rhi-uat-functions']))[0]
assert worker['HostConfig']['NetworkMode'] == 'rhi_uat_isolated'
assert json.loads(subprocess.check_output(['docker', 'network', 'inspect', 'rhi_uat_isolated']))[0]['Internal']
folder = root / 'functions/bundles'
bundle, manifest = folder / 'make-server-f781cd00.eszip', folder / 'manifest.json'
assert digest(bundle) == receipt['original_sha256']
records = json.loads(manifest.read_text())
record = next(row for row in records if row['slug'] == 'make-server-f781cd00')
assert record['sha256'] == receipt['original_sha256']
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
archive = root / ('scope-rehearsal-' + stamp)
archive.mkdir(mode=0o700)
shutil.copy2(bundle, archive / bundle.name)
shutil.copy2(manifest, archive / manifest.name)
passed = False
try:
    subprocess.run(['docker', 'stop', 'rhi-uat-functions'], check=True, stdout=subprocess.DEVNULL)
    shutil.copyfile(candidate, bundle)
    record['sha256'] = receipt['patched_sha256']
    manifest.write_text(json.dumps(records, indent=2))
    subprocess.run(['docker', 'start', 'rhi-uat-functions'], check=True, stdout=subprocess.DEVNULL)
    for script, arguments in [('run-uat-messaging-contract.py', []),
                              ('smoke-business-writes.py', ['--uat']), ('smoke-uat-workflows.py', [])]:
        subprocess.run(['python3', '/opt/rhi/migration/' + script, *arguments], check=True)
    for name in ['kirimdev-prospects-verification.json', 'business-write-verification.json', 'workflow-verification.json']:
        shutil.copy2(root / name, archive / name)
    assert not list(root.glob('*fixture.json')) and not list(root.glob('*fixtures.json'))
    passed = True
finally:
    subprocess.run(['docker', 'stop', 'rhi-uat-functions'], check=True, stdout=subprocess.DEVNULL)
    shutil.copy2(archive / bundle.name, bundle)
    shutil.copy2(archive / manifest.name, manifest)
    subprocess.run(['docker', 'start', 'rhi-uat-functions'], check=True, stdout=subprocess.DEVNULL)
    restored = digest(bundle) == receipt['original_sha256']
    result = {'completed_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'candidate_sha256': receipt['patched_sha256'], 'passed': passed,
              'baseline_restored': restored, 'artifacts': str(archive),
              'source_changed': False, 'public_preview_changed': False,
              'real_provider_messages_sent': False}
    (root / 'scoped-bundle-verification.json').write_text(json.dumps(result, indent=2))
    assert restored
print(json.dumps(result))
