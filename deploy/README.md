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

- **Exactly one backend process.** In-flight QR logins (gramjs clients,
  password deferreds) live in process memory — `deploy/pm2/ecosystem.config.cjs`
  pins `exec_mode: "fork"`, `instances: 1`. A deploy restart briefly (<1s)
  interrupts the service; an in-flight QR login restarts, a _stored_ session is
  unaffected (it lives encrypted in Postgres).
- **TLS terminates at Cloudflare**; the Cloudflare-to-origin hop is encrypted
  with a **Cloudflare Origin CA certificate** at `/etc/tac/tls/{origin.pem,origin.key}`
  (SSL mode **Full (strict)**). Provision it once by hand: Cloudflare dashboard
  → SSL/TLS → Origin Server → Create Certificate, then install both files mode
  600 root-owned.
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
| `tac-deploy/prd`  | workflow only          | `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `SSH_PORT` (opt)                                                                                                                        |
| `tac-backend/prd` | service (+ migrations) | `DATABASE_URL`, `ENCRYPTION_SECRET`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `PUBLIC_BASE_URL`, `PORT=8300`, `NODE_ENV=production`, `CORS_ORIGIN` (opt), `LOGIN_TTL_SECONDS` (opt) |

The entire `tac-backend/prd` config is exported verbatim to
`/etc/tac/backend.env` on each deploy — adding a variable in Doppler and
re-running the workflow is all it takes. Keep values single-line (the env file
is parsed literally after `=`).

## One-time server setup

1. Fresh Debian/Ubuntu box: `sudo bash deploy/scripts/bootstrap.sh`
   (creates the `tac` service user, `/opt/tac`, `/etc/tac`, installs Node 22,
   nginx, ufw, pm2 + boot unit).
2. Give the CI deploy user passwordless sudo, e.g. as root:
   `echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/deploy` (or scope it
   to the commands used in the scripts).
3. Provision the Cloudflare Origin CA certificate at `/etc/tac/tls/`.
4. Point a **proxied** Cloudflare DNS record at the server; set that URL as
   `PUBLIC_BASE_URL` in `tac-backend/prd`.
5. Create the two Doppler service tokens and add them as GitHub repo secrets.

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
