#!/usr/bin/env bash
set -euo pipefail

# Run only on the new, dedicated RHI VPS. Does not deploy or contact production.
test "$(id -u)" = 0
test "$(hostname -s)" = srv2126686
ip -4 address show | grep -q '187\.124\.141\.159/'
. /etc/os-release
test "$ID" = ubuntu
test "$VERSION_ID" = 24.04

install -d -m 0700 /opt/rhi /opt/rhi/migration /opt/rhi/backups
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git jq python3 ufw
install -d -m 0755 /etc/apt/keyrings
curl --fail --silent --show-error https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod 0644 /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $VERSION_CODENAME
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Keep SSH available. Container ports must separately bind to loopback; Docker
# port publishing can bypass UFW. No database or dashboard is published here.
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw default deny incoming
ufw default allow outgoing
ufw --force enable
systemctl enable --now docker
docker version --format '{{.Server.Version}}'
docker compose version
ufw status
