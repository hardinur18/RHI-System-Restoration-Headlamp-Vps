#!/usr/bin/env python3
"""Create a private disposable UAT copy, without touching source or preview data.

Uses a new database, separate Storage bytes, distinct JWT keys, internal-only
containers and a mail catcher. The gateway is bound to host loopback only.
Production provider credentials are replaced with test values. No cron is copied.
"""
import base64
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import time
from urllib.parse import urlsplit, urlunsplit

assert socket.gethostname().split('.')[0] == 'srv2126686' and os.geteuid() == 0
os.umask(0o077)
root = Path('/opt/rhi/uat-20261106')
root.mkdir(mode=0o700, exist_ok=True)
database = 'rhi_uat_20261106'
backup = Path('/opt/rhi/backups/daily-database/20261106T130114Z')
progress_path = root / 'preparation.json'
progress = json.loads(progress_path.read_text()) if progress_path.exists() else {'database': database, 'backup': str(backup)}
assert progress['database'] == database and progress['backup'] == str(backup)

def save():
    progress_path.write_text(json.dumps(progress, indent=2))

def run(command, name):
    with (root / name).open('w') as log:
        subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True)

spec = importlib.util.spec_from_file_location('delta', '/opt/rhi/migration/plan-delta.py')
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)
if not progress.get('restored'):
    with (root / 'archive-check.log').open('w') as log:
        subprocess.run(['sha256sum', '-c', 'SHA256SUMS'], cwd=backup, stdout=log, stderr=subprocess.STDOUT, check=True)
    if not progress.get('database_created'):
        with delta.connection_target(admin=True) as db, db.cursor() as cur:
            cur.execute('select 1 from pg_database where datname=%s', (database,))
            assert cur.fetchone() is None, 'Refuse an existing unowned database'
        run(['docker', 'exec', 'supabase-db', 'createdb', '-U', 'supabase_admin', '-T', 'template0', database], 'createdb.log')
        progress['database_created'] = True
        save()
    with delta.connection_target(admin=True, database=database) as db, db.cursor() as cur:
        cur.execute('CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; '
            'CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions; '
            'CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin; '
            'CREATE SCHEMA IF NOT EXISTS storage AUTHORIZATION supabase_storage_admin; '
            'CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE SCHEMA IF NOT EXISTS rhi_migration;')
        cur.execute("SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime'")
        if cur.fetchone() is None:
            cur.execute('CREATE PUBLICATION supabase_realtime')
        cur.execute('REVOKE CONNECT ON DATABASE ' + database + ' FROM PUBLIC')
        cur.execute('GRANT CONNECT ON DATABASE ' + database + ' TO authenticator, supabase_auth_admin, supabase_storage_admin')
    with (backup / 'postgres.dump').open('rb') as archive, (root / 'restore.log').open('w') as log:
        subprocess.run(['docker', 'exec', '-i', 'supabase-db', 'pg_restore', '-U', 'supabase_admin', '-d', database,
            '--single-transaction', '--exit-on-error', '-n', 'auth', '-n', 'storage', '-n', 'public',
            '-n', 'supabase_migrations', '-n', 'rhi_migration'], stdin=archive, stdout=log, stderr=log, check=True)
    with delta.connection_target(admin=True, database=database) as db, db.cursor() as cur:
        cur.execute(Path('/opt/rhi/migration/disable-preview-fence.sql').read_text())
        cur.execute("SELECT count(*) FROM pg_tables WHERE schemaname IN ('public','auth','storage','supabase_migrations')")
        assert cur.fetchone()[0] >= 110
    progress['restored'] = True
    save()
    print('Separate UAT database restored; preview write fence unchanged', flush=True)

# Schema filters in pg_restore do not restore every schema-level grant. Copy
# the original schema ownership/ACL explicitly, within the disposable DB only.
with delta.connection_target(admin=True) as original, original.cursor() as cur:
    cur.execute("SELECT nspname,pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname IN ('public','auth','storage','extensions','supabase_migrations','rhi_migration')")
    owners = cur.fetchall()
    cur.execute("SELECT nspname,CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,x.privilege_type,x.is_grantable FROM pg_namespace CROSS JOIN LATERAL aclexplode(nspacl) x WHERE nspname IN ('public','auth','storage','extensions','supabase_migrations','rhi_migration')")
    grants = cur.fetchall()
with delta.connection_target(admin=True, database=database) as db, db.cursor() as cur:
    for schema, owner in owners:
        cur.execute(delta.sql.SQL('ALTER SCHEMA {} OWNER TO {}').format(delta.sql.Identifier(schema), delta.sql.Identifier(owner)))
    for schema, role, privilege, grantable in grants:
        assert privilege in ('USAGE', 'CREATE')
        cur.execute(delta.sql.SQL('GRANT {} ON SCHEMA {} TO {}{}').format(
            delta.sql.SQL(privilege), delta.sql.Identifier(schema),
            delta.sql.SQL('PUBLIC') if role == 'PUBLIC' else delta.sql.Identifier(role),
            delta.sql.SQL(' WITH GRANT OPTION' if grantable else '')))
progress['schema_grants_copied'] = True
save()

if not progress.get('storage_copied'):
    assert shutil.disk_usage(root).free > 35 * 1024**3, 'Keep enough room for the independent Storage copy'
    storage = root / 'storage'
    storage.mkdir(mode=0o700, exist_ok=True)
    run(['cp', '-a', '--reflink=auto', '/opt/rhi/supabase/volumes/storage/.', str(storage)], 'storage-copy.log')
    progress['storage_copied'] = True
    save()
    print('Separate writable Storage copy created', flush=True)

keys_path = root / 'keys.json'
if keys_path.exists():
    keys = json.loads(keys_path.read_text())
else:
    secret = secrets.token_urlsafe(48)
    def token(role):
        encode = lambda value: base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).decode().rstrip('=')
        body = encode({'alg': 'HS256', 'typ': 'JWT'}) + '.' + encode({'role': role, 'iss': 'supabase',
            'iat': int(time.time()), 'exp': int(time.time()) + 7*86400})
        return body + '.' + base64.urlsafe_b64encode(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()).decode().rstrip('=')
    keys = {'JWT_SECRET': secret, 'ANON_KEY': token('anon'), 'SERVICE_ROLE_KEY': token('service_role')}
    keys_path.write_text(json.dumps(keys))

network = 'rhi_uat_isolated'
if subprocess.run(['docker', 'network', 'inspect', network], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
    run(['docker', 'network', 'create', '--internal', '--subnet', '172.30.45.0/24', network], 'network-create.log')
net = json.loads(subprocess.check_output(['docker', 'network', 'inspect', network]))[0]
assert net['Internal']
db_inspect = json.loads(subprocess.check_output(['docker', 'inspect', 'supabase-db']))[0]
if network not in db_inspect['NetworkSettings']['Networks']:
    run(['docker', 'network', 'connect', '--alias', 'rhi-uat-db', network, 'supabase-db'], 'network-connect.log')

def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]

def db_url(old):
    url = urlsplit(old)
    return urlunsplit((url.scheme, url.netloc.rsplit('@', 1)[0] + '@rhi-uat-db:5432', '/' + database, url.query, url.fragment))

def start(name, image, env, extra=(), command=()):
    if subprocess.run(['docker', 'container', 'inspect', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
        existing = inspect(name)
        assert existing['Config']['Labels'].get('rhi.purpose') == 'disposable-uat'
        assert network in existing['NetworkSettings']['Networks']
        return
    env_path = root / (name + '.env')
    assert all('\n' not in value for value in env.values())
    env_path.write_text('\n'.join(key + '=' + value for key, value in env.items()) + '\n')
    run(['docker', 'run', '-d', '--name', name, '--network', network, '--env-file', str(env_path),
         '--label', 'rhi.purpose=disposable-uat', *extra, image, *command], name + '-start.log')

mail_image = 'axllent/mailpit:v1.27.4@sha256:df6c2541907e1be6fac21f509927cf6ed771617a1f4b361ef66d97bd05593d2d'
start('rhi-uat-mail', mail_image, {'MP_MAX_MESSAGES': '100', 'MP_SMTP_AUTH_ACCEPT_ANY': '1',
    'MP_SMTP_AUTH_ALLOW_INSECURE': '1'}, ['-p', '127.0.0.1:18025:8025'])

auth = inspect('supabase-auth')
env = dict(item.split('=', 1) for item in auth['Config']['Env'])
env.update(GOTRUE_DB_DATABASE_URL=db_url(env['GOTRUE_DB_DATABASE_URL']), GOTRUE_JWT_SECRET=keys['JWT_SECRET'],
    GOTRUE_JWT_ISSUER='http://127.0.0.1:18080/auth/v1', API_EXTERNAL_URL='http://127.0.0.1:18080',
    GOTRUE_SITE_URL='http://127.0.0.1:18080', GOTRUE_URI_ALLOW_LIST='http://127.0.0.1:18080/**',
    GOTRUE_SMTP_HOST='rhi-uat-mail', GOTRUE_SMTP_PORT='1025', GOTRUE_SMTP_USER='', GOTRUE_SMTP_PASS='',
    GOTRUE_SMTP_ADMIN_EMAIL='noreply@example.invalid', GOTRUE_SMTP_SENDER_NAME='RHI UAT')
start('rhi-uat-auth', auth['Config']['Image'], env)

rest = inspect('supabase-rest')
env = dict(item.split('=', 1) for item in rest['Config']['Env'])
env.update(PGRST_DB_URI=db_url(env['PGRST_DB_URI']), PGRST_JWT_SECRET=keys['JWT_SECRET'], PGRST_DB_SCHEMAS='public')
start('rhi-uat-rest', rest['Config']['Image'], env)

storage = inspect('supabase-storage')
env = dict(item.split('=', 1) for item in storage['Config']['Env'])
env.update(DATABASE_URL=db_url(env['DATABASE_URL']), AUTH_JWT_SECRET=keys['JWT_SECRET'],
    ANON_KEY=keys['ANON_KEY'], SERVICE_KEY=keys['SERVICE_ROLE_KEY'], POSTGREST_URL='http://rhi-uat-rest:3000',
    STORAGE_PUBLIC_URL='http://127.0.0.1:18080/storage/v1', ENABLE_IMAGE_TRANSFORMATION='false', IMGPROXY_URL='',
    S3_PROTOCOL_ACCESS_KEY_ID='rhi-uat', S3_PROTOCOL_ACCESS_KEY_SECRET=secrets.token_urlsafe(32))
start('rhi-uat-storage', storage['Config']['Image'], env, ['-v', str(root / 'storage') + ':/var/lib/storage'])

functions = inspect('supabase-edge-functions')
if not progress.get('cache_copied'):
    cache = root / 'deno-cache'
    cache.mkdir(mode=0o700, exist_ok=True)
    source_cache = next(m['Source'] for m in functions['Mounts'] if m['Destination'] == '/root/.cache/deno')
    run(['cp', '-a', '--reflink=auto', source_cache + '/.', str(cache)], 'cache-copy.log')
    progress['cache_copied'] = True
    save()
env = dict(item.split('=', 1) for item in functions['Config']['Env'])
for name in list(env):
    if any(word in name for word in ('TOKEN', 'SECRET', 'ACCESS_KEY', 'API_KEY')):
        env[name] = 'uat-only-' + secrets.token_hex(24)
env.update(SUPABASE_URL='http://rhi-uat-gateway:8080', SUPABASE_PUBLIC_URL='http://127.0.0.1:18080',
    SUPABASE_ANON_KEY=keys['ANON_KEY'], SUPABASE_SERVICE_ROLE_KEY=keys['SERVICE_ROLE_KEY'], JWT_SECRET=keys['JWT_SECRET'],
    SUPABASE_PUBLISHABLE_KEYS='{}', SUPABASE_SECRET_KEYS='{}', APP_ALLOWED_ORIGINS='http://127.0.0.1:18080',
    TIKTOK_REDIRECT_URI='http://127.0.0.1:18080/', RHI_DEPLOYMENT_MODE='staging',
    SUPABASE_DB_URL=db_url(env['SUPABASE_DB_URL']))
start('rhi-uat-functions', functions['Config']['Image'], env,
    ['-v', str(root / 'functions' if (root / 'functions').is_dir() else Path('/opt/rhi/supabase/volumes/functions')) + ':/home/deno/functions:ro',
     '-v', str(root / 'deno-cache') + ':/root/.cache/deno',
     '-v', str(root / 'edge-router.ts') + ':/home/deno/functions/main/index.ts:ro'],
    ['start', '--user-worker-request-idle-timeout', '150000', '--main-service', '/home/deno/functions/main'])

start('rhi-uat-gateway', 'nginx:1.28-alpine', {}, ['-p', '127.0.0.1:18080:8080',
    '-v', str(root / 'gateway.conf') + ':/etc/nginx/nginx.conf:ro'])
# Docker does not publish ports on this internal bridge. Keep the network
# isolated and expose only explicit host-loopback Nginx listeners instead.
gateway_ip = inspect('rhi-uat-gateway')['NetworkSettings']['Networks'][network]['IPAddress']
mail_ip = inspect('rhi-uat-mail')['NetworkSettings']['Networks'][network]['IPAddress']
proxy_config = Path('/etc/nginx/conf.d/rhi-uat-loopback.conf')
proxy_config.write_text('server { listen 127.0.0.1:18080; client_max_body_size 50m; '
    'location / { proxy_read_timeout 180s; proxy_set_header Host $http_host; '
    'proxy_pass http://' + gateway_ip + ':8080; } }\n'
    'server { listen 127.0.0.1:18025; location / { proxy_pass http://' + mail_ip + ':8025; } }\n')
run(['nginx', '-t'], 'host-nginx-check.log')
run(['systemctl', 'reload', 'nginx'], 'host-nginx-reload.log')
progress['containers_created'] = True
save()
print('Private UAT containers created; readiness and data comparison still required', flush=True)
