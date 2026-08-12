#!/usr/bin/env bash
#
# remote-deploy.sh — runs ON the server, invoked by the deploy-backend workflow
# over SSH after the built bundle, its runtime deps and this `deploy/` tree
# have been uploaded to /opt/tac.
#
# The deploy (SSH) user must have passwordless sudo (see deploy/README.md). The
# workflow exports SSH_PORT (for the firewall's SSH rule) before invoking:
#
#   SSH_PORT=22 bash /opt/tac/deploy/scripts/remote-deploy.sh
#
# TLS terminates at Cloudflare — nginx serves the origin with a Cloudflare
# Origin CA certificate (SSL mode "Full (strict)"); ufw restricts 80/443 to
# Cloudflare's IP ranges, so the vhost is a catch-all installed verbatim.
set -euo pipefail

readonly DEPLOY_DIR="/opt/tac"
readonly SERVICE_USER="tac"
readonly SERVICE_HOME="/home/tac"
readonly ECOSYSTEM="${DEPLOY_DIR}/deploy/pm2/ecosystem.config.cjs"
readonly NGINX_CONF="${DEPLOY_DIR}/deploy/nginx/tac-backend.conf"
readonly NGINX_SITE="/etc/nginx/sites-available/tac-backend.conf"
readonly NGINX_SITE_LINK="/etc/nginx/sites-enabled/tac-backend.conf"
readonly TLS_CERT="/etc/tac/tls/origin.pem"
readonly TLS_KEY="/etc/tac/tls/origin.key"

# pm2 runs entirely under the `tac` service user (its process list, logs and
# dump file live in /home/tac/.pm2); sudo -u with an explicit HOME keeps every
# invocation pointed at that one pm2 daemon.
#
# The working directory is forced to ${DEPLOY_DIR}: sudo keeps the caller's cwd,
# and the deploy user's home (/root when SSH_USER=root, mode 700) is not
# traversable by the service user — pm2 then fails to spawn its daemon with
# `spawn /usr/bin/node EACCES`.
pm2_as_service_user() {
  (cd "${DEPLOY_DIR}" && sudo -u "${SERVICE_USER}" \
    env HOME="${SERVICE_HOME}" PM2_HOME="${SERVICE_HOME}/.pm2" pm2 "$@")
}

# The service MUST run as exactly one process (in-flight Telegram QR logins
# are held in memory), so the ecosystem uses fork mode with a single instance.
# startOrReload on a fork-mode app is a restart — a brief (<1s) gap is
# inherent and accepted; an in-flight QR login simply restarts.
reload_pm2_service() {
  echo "remote-deploy: restarting pm2 service (single instance, fork mode)"
  pm2_as_service_user startOrReload "${ECOSYSTEM}" --update-env
  # Persist the process list so the pm2 boot unit resurrects it after reboot.
  pm2_as_service_user save
}

# The vhost terminates TLS with the certificate at /etc/tac/tls — normally
# Let's Encrypt symlinks installed by bootstrap.sh (TLS_DOMAIN +
# CLOUDFLARE_API_TOKEN in the deploy Doppler config), or a manually
# provisioned pair. nginx refuses to start without it, so fail here with a
# message that names the missing file instead.
assert_origin_certificate() {
  local path
  for path in "${TLS_CERT}" "${TLS_KEY}"; do
    if ! sudo test -f "${path}"; then
      echo "remote-deploy: missing ${path} — set TLS_DOMAIN/CLOUDFLARE_API_TOKEN in the deploy Doppler config (certbot bootstrap) or provision the certificate manually (see deploy/README.md)" >&2
      return 1
    fi
  done
}

install_nginx_vhost() {
  echo "remote-deploy: installing nginx vhost"
  assert_origin_certificate
  sudo install -m 644 "${NGINX_CONF}" "${NGINX_SITE}"
  sudo ln -sf "${NGINX_SITE}" "${NGINX_SITE_LINK}"
  sudo nginx -t
  sudo systemctl reload nginx
}

configure_firewall() {
  echo "remote-deploy: applying ufw policy (SSH + Cloudflare-only HTTP)"
  sudo SSH_PORT="${SSH_PORT:-22}" bash "${DEPLOY_DIR}/deploy/scripts/configure-firewall.sh"
}

health_check() {
  local url="$1"
  local attempt
  for attempt in 1 2 3 4 5; do
    if curl -fsS "${url}" >/dev/null; then
      echo "remote-deploy: health OK ${url}"
      return 0
    fi
    echo "remote-deploy: health check ${url} failed (attempt ${attempt}), retrying"
    sleep 3
  done
  echo "remote-deploy: health check FAILED ${url}" >&2
  return 1
}

main() {
  # The bundle is uploaded by the deploy user and stays owned by it. The `tac`
  # service user only needs read+execute access, which rsync's default
  # world-readable perms provide — so no chown is needed (and chowning away from
  # the deploy user would break the next rsync upload).
  reload_pm2_service
  install_nginx_vhost
  configure_firewall
  health_check "http://localhost:8300/healthz"
  echo "remote-deploy: done"
}

main "$@"
