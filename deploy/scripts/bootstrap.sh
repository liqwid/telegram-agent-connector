#!/usr/bin/env bash
#
# bootstrap.sh — idempotent server preparation for the Telegram Agent
# Connector backend.
#
# Runs on EVERY deploy from the GitHub Actions workflow, piped over SSH and
# executed as root (`sudo bash -s`), BEFORE the artifacts are uploaded. Safe to
# re-run: every step checks current state first and no-ops when the server is
# already provisioned — a normal deploy passes straight through. Can equally be
# run by hand on a fresh box: sudo bash deploy/scripts/bootstrap.sh
#
# It ensures:
#   - the `tac` system user that runs the Node service under pm2
#   - /opt/tac (code) and /etc/tac (env, mode 750 root:tac)
#   - Node.js 22 (NodeSource), nginx, ufw, rsync/curl, pm2 (global npm)
#   - the pm2 systemd boot unit for the `tac` user; nginx enabled
#
# TLS terminates at Cloudflare; the Cloudflare-to-origin certificate at
# /etc/tac/tls is provisioned by hand once (see deploy/README.md) — this
# script never touches it.
set -euo pipefail

readonly SERVICE_USER="tac"
readonly DEPLOY_DIR="/opt/tac"
readonly ENV_DIR="/etc/tac"
readonly PM2_BOOT_UNIT="/etc/systemd/system/pm2-${SERVICE_USER}.service"

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "bootstrap: must run as root (use sudo)" >&2
    exit 1
  fi
}

# apt-get update is the slow step; run it at most once, and only when a
# package actually needs installing.
apt_updated=""
apt_install_if_missing() {
  local missing=()
  local package
  for package in "$@"; do
    if ! dpkg -s "${package}" >/dev/null 2>&1; then
      missing+=("${package}")
    fi
  done
  if [[ "${#missing[@]}" -eq 0 ]]; then
    echo "bootstrap: packages already installed: $*"
    return
  fi
  if [[ -z "${apt_updated}" ]]; then
    apt-get update
    apt_updated="done"
  fi
  echo "bootstrap: installing: ${missing[*]}"
  DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing[@]}"
}

ensure_service_user() {
  if id "${SERVICE_USER}" >/dev/null 2>&1; then
    echo "bootstrap: service user ${SERVICE_USER} already exists"
    return
  fi
  echo "bootstrap: creating system user ${SERVICE_USER}"
  useradd --system --create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
}

ensure_directories() {
  # install -d is idempotent: creates when absent, (re)asserts owner/mode when
  # present — which is what we want if a manual chmod ever drifts.
  install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 755 "${DEPLOY_DIR}"
  # Group-owned by the service user: the pm2 ecosystem config reads
  # ${ENV_DIR}/backend.env as `tac`, so it must traverse this directory.
  install -d -o root -g "${SERVICE_USER}" -m 750 "${ENV_DIR}"
  echo "bootstrap: directories ${DEPLOY_DIR} and ${ENV_DIR} ensured"
}

ensure_node() {
  if command -v node >/dev/null 2>&1 && node --version | grep -q '^v22'; then
    echo "bootstrap: Node 22 already installed ($(node --version))"
    return
  fi
  echo "bootstrap: installing Node.js 22 from NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
}

ensure_nginx_and_ufw() {
  apt_install_if_missing nginx ufw
  # The tac vhost owns the domain; the distro default site would shadow
  # unmatched requests with its own welcome page — drop it.
  rm -f /etc/nginx/sites-enabled/default
  systemctl enable --now nginx
}

ensure_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    echo "bootstrap: pm2 already installed ($(pm2 --version))"
  else
    echo "bootstrap: installing pm2 globally"
    npm install -g pm2
  fi
  # The systemd boot unit resurrects the tac user's pm2 process list (saved by
  # `pm2 save` during each deploy) on server reboot. `pm2 startup` rewrites
  # the unit unconditionally, so guard on its presence to keep re-runs no-op.
  if [[ -f "${PM2_BOOT_UNIT}" ]]; then
    echo "bootstrap: pm2 boot unit already installed"
    return
  fi
  echo "bootstrap: installing pm2 startup unit for ${SERVICE_USER}"
  pm2 startup systemd -u "${SERVICE_USER}" --hp "/home/${SERVICE_USER}"
}

main() {
  require_root
  apt_install_if_missing curl ca-certificates gnupg rsync
  ensure_service_user
  ensure_directories
  ensure_node
  ensure_nginx_and_ufw
  ensure_pm2
  echo "bootstrap: done (idempotent — safe to run on every deploy)"
}

main "$@"
