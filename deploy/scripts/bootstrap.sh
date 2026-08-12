#!/usr/bin/env bash
#
# bootstrap.sh — one-time server preparation for the Telegram Agent Connector
# backend.
#
# Run ONCE manually on a fresh Linux (Debian/Ubuntu) server AS ROOT:
#
#   sudo bash deploy/scripts/bootstrap.sh
#
# It is idempotent where reasonable, so re-running is safe. It:
#   - creates the `tac` system user that runs the Node service under pm2
#   - creates /opt/tac (code) and /etc/tac (env, mode 750 root:tac)
#   - installs Node.js 22 (NodeSource), nginx, ufw, and pm2 (global npm)
#   - installs the pm2 boot unit for the `tac` user and enables nginx
#
# TLS terminates at Cloudflare (proxied DNS record); the Cloudflare-to-origin
# hop uses a Cloudflare Origin CA certificate provisioned by hand at
# /etc/tac/tls (see deploy/README.md) — no certbot is installed.
#
# After this, grant the CI deploy user passwordless sudo (see deploy/README.md)
# and point a proxied Cloudflare DNS record for your domain at this server.
set -euo pipefail

readonly SERVICE_USER="tac"
readonly DEPLOY_DIR="/opt/tac"
readonly ENV_DIR="/etc/tac"

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "bootstrap: must run as root (use sudo)" >&2
    exit 1
  fi
}

create_service_user() {
  if id "${SERVICE_USER}" >/dev/null 2>&1; then
    echo "bootstrap: service user ${SERVICE_USER} already exists"
    return
  fi
  echo "bootstrap: creating system user ${SERVICE_USER}"
  useradd --system --create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
}

create_directories() {
  echo "bootstrap: creating ${DEPLOY_DIR} and ${ENV_DIR}"
  install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 755 "${DEPLOY_DIR}"
  # Group-owned by the service user: the pm2 ecosystem config reads
  # ${ENV_DIR}/backend.env as `tac`, so it must traverse this directory.
  install -d -o root -g "${SERVICE_USER}" -m 750 "${ENV_DIR}"
}

install_node() {
  if command -v node >/dev/null 2>&1 && node --version | grep -q '^v22'; then
    echo "bootstrap: Node 22 already installed ($(node --version))"
    return
  fi
  echo "bootstrap: installing Node.js 22 from NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
}

install_nginx_and_ufw() {
  echo "bootstrap: installing nginx and ufw"
  apt-get install -y nginx ufw
  # The tac vhost owns the domain; the distro default site would shadow
  # unmatched requests with its own welcome page — drop it.
  rm -f /etc/nginx/sites-enabled/default
  systemctl enable --now nginx
}

install_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    echo "bootstrap: pm2 already installed ($(pm2 --version))"
  else
    echo "bootstrap: installing pm2 globally"
    npm install -g pm2
  fi
  # Install the systemd boot unit that resurrects the tac user's pm2 process
  # list (saved by `pm2 save` during each deploy) on server reboot.
  echo "bootstrap: installing pm2 startup unit for ${SERVICE_USER}"
  pm2 startup systemd -u "${SERVICE_USER}" --hp "/home/${SERVICE_USER}"
}

main() {
  require_root
  apt-get update
  # rsync: workflow uploads bundles; curl/gnupg: NodeSource repo setup,
  # Cloudflare IP-range fetch, health checks.
  apt-get install -y curl ca-certificates gnupg rsync
  create_service_user
  create_directories
  install_node
  install_nginx_and_ufw
  install_pm2
  echo "bootstrap: done. Grant the CI deploy user passwordless sudo and configure DNS."
}

main "$@"
