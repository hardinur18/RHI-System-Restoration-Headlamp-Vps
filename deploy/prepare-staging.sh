#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
test "$(hostname -s)" = srv2126686
test "$(git -C /opt/rhi/supabase-upstream rev-parse HEAD)" = bc27d2661edd09a5d0b8d76ce33da6d4071a756e
test ! -e /opt/rhi/supabase
test -f /opt/rhi/migration/runtime.env
umask 077
cp -a /opt/rhi/supabase-upstream/docker /opt/rhi/supabase
cd /opt/rhi/supabase
cp .env.example .env
sh utils/generate-keys.sh --update-env > /opt/rhi/migration/generated-target-keys.txt
chmod 0600 .env /opt/rhi/migration/generated-target-keys.txt
python3 - <<'PY'
from pathlib import Path
p = Path('.env')
values = {
    'COMPOSE_FILE': 'docker-compose.yml:compose.staging.yml',
    'SUPABASE_PUBLIC_URL': 'https://api-rhi.polesheadlamp.id',
    'API_EXTERNAL_URL': 'https://api-rhi.polesheadlamp.id',
    'SITE_URL': 'https://rhi.polesheadlamp.id',
    'ADDITIONAL_REDIRECT_URLS': 'https://rhi.polesheadlamp.id/**',
    'POOLER_TENANT_ID': 'rhi-vps',
    'STUDIO_DEFAULT_ORGANIZATION': 'RHI',
    'STUDIO_DEFAULT_PROJECT': 'Polesheadlamp VPS staging',
    'OPENAI_API_KEY': '',
    'FUNCTIONS_VERIFY_JWT': 'true',
    'ENABLE_PHONE_SIGNUP': 'false',
    'ENABLE_PHONE_AUTOCONFIRM': 'false',
    # No mail service is provisioned yet; never use source delivery in staging.
    'SMTP_HOST': '127.0.0.1',
    'SMTP_USER': '',
    'SMTP_PASS': '',
    'SMTP_SENDER_NAME': 'RHI System',
}
lines = p.read_text().splitlines()
seen = set()
for i, line in enumerate(lines):
    key = line.split('=', 1)[0]
    if key in values:
        lines[i] = key + '=' + values[key]
        seen.add(key)
lines += [k + '=' + v for k, v in values.items() if k not in seen]
p.write_text('\n'.join(lines) + '\n')
PY
cp /opt/rhi/migration/compose.staging.yml compose.staging.yml
docker compose config --quiet
docker compose up -d --wait db
docker exec supabase-db psql -U postgres -d postgres -Atc "select version(); show cron.launch_active_jobs;"
