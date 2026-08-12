#!/usr/bin/env bash
#
# configure-firewall.sh — ufw policy for a Cloudflare-fronted origin.
#
# Invoked with sudo by remote-deploy.sh on every deploy (SSH_PORT exported by
# the workflow; defaults to 22). Policy:
#   - default deny incoming, allow outgoing
#   - SSH rate-limited on ${SSH_PORT}
#   - ports 80 and 443 admitted ONLY from Cloudflare's published IP ranges
#
# Cloudflare's ranges are fetched live and cached in /etc/tac; the rules
# (tagged with a `cloudflare` ufw comment) are rewritten only when the published
# ranges — or the admitted ports — change, so a normal deploy is a no-op here.
set -euo pipefail

readonly SSH_PORT="${SSH_PORT:-22}"
readonly RANGES_CACHE="/etc/tac/cloudflare-ip-ranges"
readonly RULE_TAG="cloudflare"
# Origin ports admitted from Cloudflare. 443 carries the traffic under SSL mode
# "Full (strict)" (the origin holds a Cloudflare Origin CA certificate); 80
# stays open for plain-HTTP zones and Cloudflare's probes.
readonly ORIGIN_PORTS=(80 443)

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "configure-firewall: must run as root (use sudo)" >&2
    exit 1
  fi
}

fetch_cloudflare_ranges() {
  # The port list is part of the cached fingerprint: the rules are rewritten
  # only when this file changes, so without it a change to ORIGIN_PORTS would
  # never reach a server whose ranges happen to be up to date.
  echo "# ports: ${ORIGIN_PORTS[*]}"
  {
    curl -fsS https://www.cloudflare.com/ips-v4
    echo
    curl -fsS https://www.cloudflare.com/ips-v6
    echo
  } | sed '/^[[:space:]]*$/d'
}

validate_ranges() {
  local ranges_file="$1"
  # Guard against an empty/garbled download nuking the allowlist: every line
  # must be a CIDR and Cloudflare publishes well over 10 ranges.
  if [[ "$(grep -cE '^[0-9a-fA-F.:]+/[0-9]+$' "${ranges_file}")" -lt 10 ]]; then
    echo "configure-firewall: fetched Cloudflare ranges look invalid, refusing to update rules" >&2
    return 1
  fi
}

ranges_changed() {
  ! diff -q "${RANGES_CACHE}" "$1" >/dev/null 2>&1
}

remove_cloudflare_rules() {
  # Delete highest-numbered first so remaining rule numbers stay valid. Only
  # rules tagged with the cloudflare comment are touched.
  #
  # `grep` exits 1 when there is nothing to delete — the normal state on a first
  # deploy (ufw still inactive, no tagged rules). Under `set -o pipefail` that
  # would abort the whole script, so the empty match is swallowed explicitly.
  ufw status numbered \
    | { grep -F "# ${RULE_TAG}" || true; } \
    | sed -E 's/^\[ *([0-9]+)\].*/\1/' \
    | sort -rn \
    | while read -r rule_number; do
        ufw --force delete "${rule_number}" >/dev/null
      done
}

allow_cloudflare_http() {
  local ranges_file="$1"
  local port
  while read -r range; do
    for port in "${ORIGIN_PORTS[@]}"; do
      ufw allow proto tcp from "${range}" to any port "${port}" comment "${RULE_TAG}" >/dev/null
    done
  done < <(grep -v '^#' "${ranges_file}")
}

apply_base_policy() {
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  # limit = allow + rate-limit brute-force attempts. MUST precede enable so an
  # SSH-invoked run cannot lock itself out.
  ufw limit "${SSH_PORT}/tcp" >/dev/null
}

update_cloudflare_rules() {
  local new_ranges
  new_ranges="$(mktemp)"
  fetch_cloudflare_ranges >"${new_ranges}"
  validate_ranges "${new_ranges}"
  if ranges_changed "${new_ranges}"; then
    echo "configure-firewall: Cloudflare ranges or ports changed, rewriting rules for ports ${ORIGIN_PORTS[*]}"
    remove_cloudflare_rules
    allow_cloudflare_http "${new_ranges}"
    install -m 644 "${new_ranges}" "${RANGES_CACHE}"
  else
    echo "configure-firewall: Cloudflare ranges and ports unchanged"
  fi
  rm -f "${new_ranges}"
}

main() {
  require_root
  apply_base_policy
  update_cloudflare_rules
  ufw --force enable >/dev/null
  echo "configure-firewall: active policy —"
  ufw status
}

main "$@"
