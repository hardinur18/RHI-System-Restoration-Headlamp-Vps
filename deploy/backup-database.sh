#!/usr/bin/env bash
# Local logical database + private configuration backup. Storage bytes and
# off-site replication need their own configured destination; this is not a
# complete disaster-recovery backup by itself.
set -euo pipefail
test "$(hostname -s)" = srv2126686
test "$(id -u)" = 0
umask 077
exec 9>/run/lock/rhi-database-backup.lock
flock -n 9
backup_root=/opt/rhi/backups/daily-database
mkdir -p "$backup_root"
backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_pending="$backup_root/.pending-$backup_stamp"
backup_final="$backup_root/$backup_stamp"
mkdir "$backup_pending"
trap 'echo "Database backup incomplete; retained in $backup_pending" >&2' ERR
docker exec supabase-db pg_dump -U supabase_admin -Fc postgres > "$backup_pending/postgres.dump"
docker exec supabase-db pg_dump -U supabase_admin -Fc _supabase > "$backup_pending/internal.dump"
docker exec supabase-db pg_dumpall -U supabase_admin --roles-only > "$backup_pending/roles.sql"
compose_files=(.env docker-compose.yml compose.staging.yml volumes/functions)
private_files=(runtime.env edge-router.ts)
for optional in docker-compose.envoy.yml compose.smtp.yml compose.production.yml compose.scheduler.yml; do
  if test -f "/opt/rhi/supabase/$optional"; then compose_files+=("$optional"); fi
done
if test -f /opt/rhi/migration/smtp.production.env; then private_files+=(smtp.production.env); fi
for optional in refresh-instagram-vps.py rhi-instagram-refresh.service rhi-instagram-refresh.timer; do
  if test -f "/opt/rhi/migration/$optional"; then private_files+=("$optional"); fi
done
tar -czf "$backup_pending/configuration.tar.gz" -C /opt/rhi/supabase \
  "${compose_files[@]}" -C /opt/rhi/migration "${private_files[@]}" \
  -C /etc nginx/sites-available/rhi letsencrypt
# Keep the exact frontend artifact alongside the server configuration. Archive
# the resolved release, never an unrelated path or only its symlink.
frontend_release=$(readlink -f /var/www/rhi/current)
case "$frontend_release" in /var/www/rhi/releases/*) ;; *) exit 1 ;; esac
tar -czf "$backup_pending/frontend.tar.gz" -C "$frontend_release" .
for archive in postgres.dump internal.dump; do
  docker exec -i supabase-db pg_restore --list < "$backup_pending/$archive" > "$backup_pending/$archive.catalog"
done
(
  cd "$backup_pending"
  sha256sum postgres.dump internal.dump roles.sql configuration.tar.gz frontend.tar.gz > SHA256SUMS
  sha256sum -c SHA256SUMS
)
mv "$backup_pending" "$backup_final"
python3 - "$backup_root" <<'PY'
import re
import shutil
import sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
assert root == Path('/opt/rhi/backups/daily-database')
backups = sorted(p for p in root.iterdir() if p.is_dir() and not p.is_symlink()
                 and re.fullmatch(r'\d{8}T\d{6}Z', p.name) and (p / 'SHA256SUMS').is_file())
for directory in backups[:-7]:
    shutil.rmtree(directory)
PY
echo "Database/configuration backup complete: $backup_final"
