#!/usr/bin/env python3
"""Read-only release evidence on the dedicated VPS; never opens the write fence."""
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import ssl

assert os.geteuid() == 0 and socket.gethostname().split('.')[0] == 'srv2126686'
os.umask(0o077)
root = Path('/opt/rhi/migration')
now = datetime.datetime.now(datetime.timezone.utc)
spec = importlib.util.spec_from_file_location('delta', root / 'plan-delta.py')
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)
db = delta.connection_target(admin=True)
with db, db.cursor() as cur:
    cur.execute('select count(*) from cron.job where active')
    active_jobs = cur.fetchone()[0]
    cur.execute('show cron.launch_active_jobs')
    cron_launcher_disabled = cur.fetchone()[0] == 'off'
fences = {}
for table in ['public.orders', 'storage.objects']:
    try:
        with db, db.cursor() as probe:
            # The migration administrator is intentionally exempt. Match
            # PostgREST's session identity as well as its service role.
            probe.execute('SET SESSION AUTHORIZATION authenticator; SET LOCAL ROLE service_role')
            probe.execute('update ' + table + ' set id=id where false')
    except Exception as error:
        fences[table] = getattr(error, 'pgcode', None) == '25006'
        if not fences[table]:
            print('Fence probe failed:', table, type(error).__name__, getattr(error, 'pgcode', None))
    else:
        fences[table] = False
db.close()

names = ['supabase-db', 'supabase-auth', 'supabase-rest', 'supabase-storage',
         'supabase-edge-functions', 'realtime-dev.supabase-realtime', 'supabase-envoy']
containers = json.loads(subprocess.check_output(['docker', 'inspect', *names], text=True))
services = {item['Name'].lstrip('/'): {
    'running': item['State']['Running'],
    'health': item['State'].get('Health', {}).get('Status', 'not_configured'),
} for item in containers}
worker = next(item for item in containers if item['Name'] == '/supabase-edge-functions')
auth = next(item for item in containers if item['Name'] == '/supabase-auth')
auth_environment = dict(value.split('=', 1) for value in auth['Config']['Env'])
auth_issuer_matches_frontend = auth_environment.get('GOTRUE_JWT_ISSUER') == 'https://api-rhi.polesheadlamp.id/auth/v1'
router_hash = hashlib.sha256((root / 'edge-router.ts').read_bytes()).hexdigest()
# The deployed original router hardcodes the internal API allowlist. The newer
# reviewed router can switch modes, but defaults to staging. Neither is inferred
# safe from an absent environment variable alone.
fixed_staging_router = router_hash == 'ab58b961900f8e3e2691739a8c5f36256d989efa5a01a2b4cc90107b871fb58f'
router_verified = fixed_staging_router or router_hash == (
    'd55b6a5d1289cc7925c79f074620203be49130545dbd19fc794c5a4849e8e2af')
worker_mode = 'staging' if fixed_staging_router else next((v.split('=', 1)[1] for v in worker['Config']['Env']
                    if v.startswith('RHI_DEPLOYMENT_MODE=')), 'staging' if router_verified else 'unknown')
networks = list(worker['NetworkSettings']['Networks'])
network_details = json.loads(subprocess.check_output(['docker', 'network', 'inspect', *networks], text=True)) if networks else []
worker_network_isolated = bool(network_details) and all(n['Internal'] for n in network_details)
certificate = ssl._ssl._test_decode_cert('/etc/letsencrypt/live/rhi.polesheadlamp.id/cert.pem')
expiry = datetime.datetime.fromtimestamp(ssl.cert_time_to_seconds(certificate['notAfter']), datetime.timezone.utc)
backups = sorted(p for p in Path('/opt/rhi/backups/daily-database').iterdir()
                 if not p.name.startswith('.') and (p / 'SHA256SUMS').is_file())
latest = backups[-1] if backups else None
backup_age_hours = (now - datetime.datetime.strptime(latest.name, '%Y%m%dT%H%M%SZ')
                    .replace(tzinfo=datetime.timezone.utc)).total_seconds() / 3600 if latest else None
if latest:
    subprocess.run(['sha256sum', '--quiet', '-c', 'SHA256SUMS'], cwd=latest, check=True)
reports = []
for path in root.glob('drive-backup-*/report.json'):
    data = json.loads(path.read_text())
    if data.get('remote_full_read_verified') and data.get('database_and_configuration_restored'):
        reports.append(data)
offsite = max(reports, key=lambda item: item['completed_utc']) if reports else None
scheduled_path = root / 'scheduled-backup-latest.json'
scheduled = json.loads(scheduled_path.read_text()) if scheduled_path.exists() else {}
scheduled_verified = bool(scheduled.get('remote_checksums_verified') and scheduled.get('new_files_download_verified')
    and scheduled.get('database_configuration_frontend_restored') and scheduled.get('remote_inventory_verified'))
authorization_path = root / 'google-drive-production-authorization.json'
authorization = json.loads(authorization_path.read_text()) if authorization_path.exists() else {}
offsite_timer = subprocess.run(['systemctl', 'is-active', 'rhi-offsite-backup.timer'], capture_output=True, text=True).stdout.strip() == 'active'
offsite_time = max([d for d in [offsite['completed_utc'] if offsite else None,
    scheduled.get('completed_utc') if scheduled_verified else None] if d], default=None)
backup_state = subprocess.run(['systemctl', 'is-active', 'rhi-database-backup.timer'], capture_output=True, text=True).stdout.strip()
report = {
    'checked_at': now.isoformat(), 'services': services,
    'auth_issuer_matches_frontend': auth_issuer_matches_frontend,
    'free_disk_gib': round(shutil.disk_usage('/opt/rhi').free / 1024**3, 2),
    'tls_days_remaining': (expiry - now).days,
    'database_preview_fence': fences, 'active_cron_jobs': active_jobs,
    'worker_mode': worker_mode, 'router_verified': router_verified,
    'worker_network_isolated': worker_network_isolated, 'cron_launcher_disabled': cron_launcher_disabled,
    'daily_database_timer_active': backup_state == 'active',
    'latest_local_backup': latest.name if latest else None,
    'latest_local_backup_checksums_verified': latest is not None,
    'latest_local_backup_age_hours': round(backup_age_hours, 2) if backup_age_hours is not None else None,
    'offsite_verified_completed_at': offsite_time,
    'offsite_inventory_verified': scheduled_verified or bool(offsite and offsite.get('remote_inventory_verified')),
    'offsite_recurring_enabled': bool(offsite_timer and authorization.get('production_reauthorized') and scheduled_verified),
    'offsite_timer_active': offsite_timer,
    'offsite_durable_oauth_confirmed': bool(authorization.get('production_reauthorized')),
    'offsite_scheduled_snapshot': scheduled.get('snapshot') if scheduled_verified else None,
    'cutover_performed': False,
}
report['preview_infrastructure_healthy'] = (
    all(v['running'] and v['health'] in ('healthy', 'not_configured') for v in services.values())
    and auth_issuer_matches_frontend
    and all(fences.values()) and active_jobs == 0 and cron_launcher_disabled
    and worker_mode == 'staging' and router_verified and worker_network_isolated
    and report['free_disk_gib'] > 20 and report['tls_days_remaining'] > 14
    and report['daily_database_timer_active'] and backup_age_hours is not None and 0 <= backup_age_hours < 26
)
(root / 'release-infrastructure.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
