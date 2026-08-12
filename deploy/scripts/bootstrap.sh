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
# TLS: when TLS_DOMAIN and CLOUDFLARE_API_TOKEN are exported by the caller,
# a Let's Encrypt certificate is issued via certbot's Cloudflare DNS-01
# challenge (inbound ports stay Cloudflare-only — no HTTP-01 possible) and
# symlinked to /etc/tac/tls/{origin.pem,origin.key}, where the nginx vhost
# expects it. A cron entry renews it automatically (certbot renews when <30
# days to expiry). Without those variables the TLS step is skipped and
# /etc/tac/tls can be provisioned by hand (see deploy/README.md).
set -euo pipefail

readonly SERVICE_USER="tac"
readonly DEPLOY_DIR="/opt/tac"
readonly ENV_DIR="/etc/tac"
readonly TLS_DIR="${ENV_DIR}/tls"
readonly CERTBOT_CREDENTIALS="${ENV_DIR}/certbot-cloudflare.ini"
readonly RENEW_CRON="/etc/cron.d/tac-certbot-renew"
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

# --- TLS via Let's Encrypt (Cloudflare DNS-01) ------------------------------

write_certbot_credentials() {
  # Rewritten every run so a rotated Cloudflare token reaches certbot; content
  # is identical otherwise. Mode 600 before the secret is written.
  install -m 600 -o root -g root /dev/null "${CERTBOT_CREDENTIALS}"
  printf 'dns_cloudflare_api_token = %s\n' "${CLOUDFLARE_API_TOKEN}" \
    > "${CERTBOT_CREDENTIALS}"
}

issue_certificate_if_missing() {
  if [[ -f "/etc/letsencrypt/live/${TLS_DOMAIN}/fullchain.pem" ]]; then
    echo "bootstrap: certificate for ${TLS_DOMAIN} already issued"
    return
  fi
  # DNS-01: certbot plants a TXT record through the Cloudflare API — no
  # inbound port needed, so the Cloudflare-only firewall stays intact.
  local email_args=(--register-unsafely-without-email)
  if [[ -n "${LETSENCRYPT_EMAIL:-}" ]]; then
    email_args=(-m "${LETSENCRYPT_EMAIL}")
  fi
  echo "bootstrap: issuing Let's Encrypt certificate for ${TLS_DOMAIN}"
  certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials "${CERTBOT_CREDENTIALS}" \
    -d "${TLS_DOMAIN}" \
    --non-interactive --agree-tos "${email_args[@]}"
}

link_certificate_into_tls_dir() {
  # The nginx vhost reads /etc/tac/tls/{origin.pem,origin.key}; symlinks keep
  # it agnostic of how the certificate is managed. certbot's live/ paths are
  # stable across renewals, so the links never need updating.
  install -d -o root -g root -m 755 "${TLS_DIR}"
  ln -sf "/etc/letsencrypt/live/${TLS_DOMAIN}/fullchain.pem" "${TLS_DIR}/origin.pem"
  ln -sf "/etc/letsencrypt/live/${TLS_DOMAIN}/privkey.pem" "${TLS_DIR}/origin.key"
  echo "bootstrap: ${TLS_DIR} linked to the ${TLS_DOMAIN} certificate"
}

ensure_renewal_cron() {
  # `certbot renew` checks expiry on every run and only acts when a
  # certificate has <30 days left; nginx is reloaded only when a renewal
  # actually happened (deploy-hook). Twice daily at odd minutes, per
  # certbot's own recommendation.
  cat > "${RENEW_CRON}" <<'EOF'
# Managed by telegram-agent-connector deploy/scripts/bootstrap.sh — do not edit.
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
17 3,15 * * * root certbot renew --quiet --deploy-hook "systemctl reload nginx"
EOF
  chmod 644 "${RENEW_CRON}"
  echo "bootstrap: renewal cron installed at ${RENEW_CRON}"
}

ensure_tls_certificate() {
  if [[ -z "${TLS_DOMAIN:-}" || -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    echo "bootstrap: TLS_DOMAIN/CLOUDFLARE_API_TOKEN not set — skipping certbot; provision ${TLS_DIR} manually (see deploy/README.md)"
    return
  fi
  apt_install_if_missing certbot python3-certbot-dns-cloudflare
  write_certbot_credentials
  issue_certificate_if_missing
  link_certificate_into_tls_dir
  ensure_renewal_cron
}

main() {
  require_root
  apt_install_if_missing curl ca-certificates gnupg rsync
  ensure_service_user
  ensure_directories
  ensure_node
  ensure_nginx_and_ufw
  ensure_pm2
  ensure_tls_certificate
  echo "bootstrap: done (idempotent — safe to run on every deploy)"
}

main "$@"
