# Deployment

One pipeline, driven from GitHub Actions
(`.github/workflows/deploy-backend.yml`): it ships the session backend to a
Linux server **over SSH**. **nginx** is the origin reverse proxy behind
**Cloudflare** (which fronts TLS), **pm2** supervises the Node service, and all
secrets/config are pulled from **Doppler** at deploy time — GitHub holds only
the two Doppler service tokens. Changes under `deploy/` (nginx vhost, pm2
ecosystem, scripts) redeploy automatically: the workflow rsyncs the whole
`deploy/` tree and re-renders/reloads nginx on every run.

## Architecture

```
  tg.<domain> ──► Cloudflare (TLS, proxied DNS) ──► nginx (:443/:80, origin)
                                                        │
                                        pm2 «tac-backend» (ONE process,
                                        fork mode — never cluster)
                                                        │
                                     ┌──────────────────┴───────────────┐
                                     ▼                                  ▼
                              Postgres (cloud)                 Telegram (MTProto)
```

- **nginx serves the landing page at `/`; everything else proxies.** The
  public page is one self-contained file, `deploy/landing/index.html`,
  installed to `/var/www/tac-landing/index.html` by `remote-deploy.sh` and
  matched by two `location =` blocks (`/` and `/index.html`). Every other path
  — `/mcp`, `/oauth/*`, `/connect`, `/v1/*`, `/openapi.json`, `/.well-known/*`
  — still reaches the backend untouched.
  ⚠️ **The site and the API must stay on one origin.** The ChatGPT app
  directory verifies domain ownership by fetching
  `/.well-known/openai-apps-challenge` from the MCP host, and the OAuth consent
  screen has to live on the connector's own domain. That is why the landing is
  served here rather than from a static host such as GitHub Pages: a hostname
  points at one server, and moving it to Pages would take `/mcp` down with it.
  The backend still renders its own onboarding page at `/`, but nginx now wins
  that path — it is reachable only directly on `:8300`.
- **`X-Forwarded-Proto` gates the 2FA password field.** The connect page shows
  a password input only when the visitor is on https, and it decides that from
  `X-Forwarded-Proto` (`controllers/connectPage.ts`). Here the header is
  trustworthy: ufw admits 80/443 from Cloudflare's ranges only, and Cloudflare
  overwrites the header with the **visitor's** scheme — which is why the vhost
  passes it through instead of substituting `$scheme`, since `$scheme` would
  describe the Cloudflare-to-origin hop and hide the field from an https
  visitor.
  ⚠️ **Self-hosting outside this shape:** if you put the backend behind a proxy
  that forwards client headers verbatim, the header is client-controlled and
  the check becomes decoration — a man-in-the-middle can strip TLS and forge
  `X-Forwarded-Proto: https`. Terminate TLS in front of the backend and set the
  header yourself (`proxy_set_header X-Forwarded-Proto $scheme;`), or accept
  that the password should be entered through the assistant instead. Running
  the backend directly on `localhost` needs nothing — that case is trusted
  because the traffic never leaves the machine.
- **Exactly one backend process.** In-flight QR logins (gramjs clients,
  password deferreds) live in process memory — `deploy/pm2/ecosystem.config.cjs`
  pins `exec_mode: "fork"`, `instances: 1`. A deploy restart briefly (<1s)
  interrupts the service; an in-flight QR login restarts, a _stored_ session is
  unaffected (it lives encrypted in Postgres).
- **TLS terminates at Cloudflare**; the Cloudflare-to-origin hop is encrypted
  with a **Let's Encrypt certificate** that bootstrap issues automatically via
  certbot's **Cloudflare DNS-01 challenge** (set `TLS_DOMAIN` +
  `CLOUDFLARE_API_TOKEN` in `tac-deploy/prd`). DNS-01 needs no inbound port,
  so the Cloudflare-only firewall stays intact; the cert is publicly trusted,
  satisfying SSL mode **Full (strict)**. certbot's live paths are symlinked to
  `/etc/tac/tls/{origin.pem,origin.key}` (what the vhost reads), and a cron
  entry (`/etc/cron.d/tac-certbot-renew`, twice daily) runs `certbot renew`,
  which checks expiry and renews below 30 days remaining, reloading nginx only
  when a renewal happened. Leaving the two variables unset skips all of this —
  you can instead provision `/etc/tac/tls` by hand (e.g. a Cloudflare Origin
  CA certificate).
- **ufw only admits Cloudflare** — `deploy/scripts/configure-firewall.sh` runs
  on every deploy: default deny incoming, rate-limited SSH, ports 80/443 open
  only to Cloudflare's published IP ranges (fetched live, cached in
  `/etc/tac/cloudflare-ip-ranges`).
- The backend listens on `PORT=8300` and connects to Postgres via
  `DATABASE_URL` (cloud — no DB on the server). **Migrations run from the CI
  runner** against the database, never on the server.
- `npm run build -w backend` produces an esbuild bundle
  (`backend/build/index.js`) that is self-contained **except** for ws's native
  accelerators (`bufferutil`, `utf-8-validate`), which gramjs's websocket
  dependency hard-requires — the workflow stages those two packages (prebuilt
  binaries ship in the npm tarballs) into `/opt/tac/backend/node_modules/`.
- The service env lives in `/etc/tac/backend.env` (mode 640, `root:tac`); the
  pm2 ecosystem config parses it at (re)load time (pm2 has no
  `EnvironmentFile=` equivalent), and `pm2 save` + the pm2 boot unit persist
  the process across reboots.

## Doppler layout

Two projects, two service tokens; GitHub Actions holds only the tokens
(`DOPPLER_DEPLOY_TOKEN`, `DOPPLER_BACKEND_TOKEN` repo secrets):

| Doppler project   | Consumed by            | Secrets                                                                                                                                                                            |
| ----------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tac-deploy/prd`  | workflow only          | `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `SSH_PORT` (opt), `TLS_DOMAIN` (opt¹), `CLOUDFLARE_API_TOKEN` (opt¹), `LETSENCRYPT_EMAIL` (opt)                                         |
| `tac-backend/prd` | service (+ migrations) | `DATABASE_URL`, `ENCRYPTION_SECRET`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `PUBLIC_BASE_URL`, `PORT=8300`, `NODE_ENV=production`, `CORS_ORIGIN` (opt), `LOGIN_TTL_SECONDS` (opt) |

¹ `TLS_DOMAIN` (e.g. `tg.example.com`) and `CLOUDFLARE_API_TOKEN` together
enable automatic Let's Encrypt provisioning in bootstrap. The token needs
**Zone → DNS → Edit** permission on the domain's zone (create it at Cloudflare
dashboard → My Profile → API Tokens). `LETSENCRYPT_EMAIL` is used for expiry
notices; without it registration proceeds email-less.

The entire `tac-backend/prd` config is exported verbatim to
`/etc/tac/backend.env` on each deploy — adding a variable in Doppler and
re-running the workflow is all it takes. Keep values single-line (the env file
is parsed literally after `=`).

## Server setup

Provisioning is part of the pipeline: the workflow pipes
`deploy/scripts/bootstrap.sh` over SSH and runs it as root on **every deploy**.
The script is idempotent — it checks each prerequisite (the `tac` service user,
`/opt/tac` + `/etc/tac`, Node 22, nginx, ufw, pm2 + boot unit, the TLS
certificate and its renewal cron) and creates it only when missing, so on an
already-provisioned server it's a fast no-op. A fresh Debian/Ubuntu box needs
no manual preparation beyond SSH access; you can also run it by hand:
`sudo TLS_DOMAIN=… CLOUDFLARE_API_TOKEN=… bash deploy/scripts/bootstrap.sh`.

What remains manual (one-time):

1. An SSH user for CI: either `root`, or a user with passwordless sudo
   (`echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/deploy`, or scoped
   to the commands used in the scripts).
2. Point a **proxied** Cloudflare DNS record at the server; set that URL as
   `PUBLIC_BASE_URL` in `tac-backend/prd` and the bare hostname as
   `TLS_DOMAIN` in `tac-deploy/prd`, plus a `CLOUDFLARE_API_TOKEN` with DNS
   edit rights on the zone.
3. Create the two Doppler service tokens and add them as GitHub repo secrets.

Then every push to `main` touching `backend/`, `common/` or `deploy/` deploys —
or run the workflow manually via **workflow_dispatch**.

## Manual operations

```bash
# On the server: status / logs (pm2 runs under the tac user)
sudo -u tac env HOME=/home/tac PM2_HOME=/home/tac/.pm2 pm2 status
sudo -u tac env HOME=/home/tac PM2_HOME=/home/tac/.pm2 pm2 logs tac-backend

# Re-run just the remote half of a deploy
SSH_PORT=22 bash /opt/tac/deploy/scripts/remote-deploy.sh
```

Note the firewall's SSH rule is `ufw limit`: more than 6 connections from one
address within 30 seconds are rejected for a while — repeated `ssh`/`scp`
invocations during debugging can trip it; the block clears on its own.
