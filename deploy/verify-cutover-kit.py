#!/usr/bin/env python3
"""Verify a staged kit and render Compose privately; never start services."""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys

assert socket.gethostname().split('.')[0] == 'srv2126686' and os.geteuid() == 0
os.umask(0o077)
kit = Path(sys.argv[1]).resolve()
assert kit.parent == Path('/opt/rhi/migration') and kit.name.startswith('cutover-')
manifest = json.loads((kit / 'kit.json').read_text())
assert manifest['status'] == 'staged-only-not-authorized-for-cutover'
assert kit.name == 'cutover-' + manifest['commit'][:12]
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
for name, expected in manifest['files'].items():
    file = kit / name
    assert file.resolve().is_relative_to(kit) and file.is_file() and not file.is_symlink()
    assert digest(file) == expected, 'Kit checksum mismatch'
assert {str(p.relative_to(kit)) for p in kit.rglob('*') if p.is_file()} == set(manifest['files']) | {'kit.json'}
assert digest(Path('/opt/rhi/supabase/volumes/functions/bundles/make-server-f781cd00.eszip')) == manifest['predecessor_bundle_sha256']
assert digest(kit / 'make-server-f781cd00.eszip') == manifest['candidate_bundle_sha256']
release = json.loads((kit / 'frontend/release.json').read_text())
assert release['read_only'] is False and release['commit'] == manifest['commit']
assert not Path('/var/www/rhi/current').resolve().is_relative_to(kit)
command = ['docker', 'compose', '--env-file', '/opt/rhi/supabase/.env',
           '-f', '/opt/rhi/supabase/docker-compose.yml',
           '-f', '/opt/rhi/supabase/docker-compose.envoy.yml',
           '-f', str(kit / 'compose.staging.yml'), '-f', str(kit / 'compose.production.yml'),
           '--profile', 'functions-ready', 'config', '--format', 'json']
# Rendered configuration contains secrets: inspect only in memory, never print it.
rendered = subprocess.run(command, cwd='/opt/rhi/supabase', capture_output=True, check=True)
config = json.loads(rendered.stdout)
functions = config['services']['functions']
assert functions['environment']['RHI_DEPLOYMENT_MODE'] == 'production'
assert functions['environment']['RHI_ADS_SYNC_PROVIDERS'] == 'meta'
assert str(functions['environment']['KV_READ_TIMEOUT_MS']) == '8000'
assert set(functions['networks']) == {'function_isolation', 'function_egress'}
assert config['networks']['function_isolation']['internal'] is True
assert not functions.get('ports')
assert 'cron.launch_active_jobs=off' in config['services']['db']['command']
for service in config['services'].values():
    for port in service.get('ports', []):
        assert port.get('host_ip') == '127.0.0.1', 'Unexpected public port'
subprocess.run(['nginx', '-t'], check=True, capture_output=True)
subprocess.run(['python3', '/opt/rhi/migration/check-release-infrastructure.py'], check=True, stdout=subprocess.DEVNULL)
infra = json.loads(Path('/opt/rhi/migration/release-infrastructure.json').read_text())
assert infra['preview_infrastructure_healthy']
print(json.dumps({'kit': kit.name, 'checksums_verified': len(manifest['files']),
                  'compose_rendered': True, 'public_preview_preserved': True,
                  'activated': False, 'remaining_gates': manifest['required_gates']}))
