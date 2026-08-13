# Changelog

## Unreleased

- **Hosted MCP connector — zero-install Claude setup.** The backend now serves
  a stateless Streamable-HTTP MCP endpoint at `POST /mcp/:accountToken` with
  the same five tools as the local bridge (QR returned as inline image), each
  request bound to the account resolved from the URL's bearer token (indexed
  lookup by token hash, migration `0003_token_hash_unique`). A new onboarding
  landing page at `/` creates an account in one click and hands out the
  personal connector URL for claude.ai / Claude Desktop / Claude Code
  (`claude mcp add --transport http …`). Request logging now redacts token
  segments (`/mcp/<token>`, `?token=`) from URLs. The local stdio bridge
  remains as an alternative.

- **Automated origin TLS.** Bootstrap now issues a Let's Encrypt certificate
  via certbot's Cloudflare DNS-01 challenge when `TLS_DOMAIN` +
  `CLOUDFLARE_API_TOKEN` (new `tac-deploy/prd` secrets, `LETSENCRYPT_EMAIL`
  optional) are set: no inbound port needed, so the Cloudflare-only firewall
  stays intact, and the publicly-trusted cert satisfies SSL mode Full
  (strict). certbot's live paths are symlinked to `/etc/tac/tls/` (the vhost
  is unchanged) and `/etc/cron.d/tac-certbot-renew` checks expiry twice daily,
  renewing below 30 days and reloading nginx only on actual renewal. Manual
  Cloudflare Origin CA provisioning remains as the fallback when the secrets
  are unset.

- **Bootstrap folded into the pipeline.** `deploy/scripts/bootstrap.sh` is now
  fully idempotent (guards on the `tac` user, directories, Node 22, apt
  packages, pm2 boot unit; `apt-get update` only when something actually needs
  installing) and the deploy workflow pipes it over SSH as root on every run —
  a fresh server provisions itself on first deploy, an existing one passes
  through in seconds. Manual setup shrinks to: SSH access, origin TLS cert,
  DNS, Doppler tokens.

- **Telegram app credentials moved to backend configuration.** `TELEGRAM_API_ID`
  and `TELEGRAM_API_HASH` are now deployment-level env secrets (Doppler
  `tac-backend/prd`, `.env` locally) — one Telegram application per deployment.
  Users are no longer prompted for api_id/api_hash anywhere: `POST /v1/accounts`
  takes no input, `telegram_connect()` takes no arguments, and the per-account
  encrypted credential columns are dropped (migration
  `0002_drop_api_credentials`). A rejected app credential now surfaces as a 500
  (operator misconfiguration), not a 400.

- **Deploy pipeline** (inherited from the `auf` blueprint): GitHub Actions
  workflow (`deploy-backend.yml`) ships the backend over SSH with all
  secrets/config pulled from two Doppler projects (`tac-deploy/prd` for the
  SSH target/key, `tac-backend/prd` exported verbatim to
  `/etc/tac/backend.env`); GitHub holds only the two Doppler tokens.
  Migrations run from CI against the cloud Postgres. `deploy/` tree:
  `bootstrap.sh` (one-time server prep), `remote-deploy.sh`,
  `configure-firewall.sh` (Cloudflare-only ufw), nginx origin vhost
  (Cloudflare Origin CA TLS), pm2 ecosystem pinned to **fork mode, 1
  instance** (in-flight QR logins are in-memory). Backend esbuild bundle is
  now fully self-contained except `bufferutil`/`utf-8-validate` (native,
  hard-required by gramjs's websocket dep), which the workflow stages as a
  minimal `node_modules` next to the bundle — verified by booting the bundle
  in isolation.

## 0.1.0 — 2026-08-12

Initial release: Telegram QR-code authentication end to end.

- **Monorepo scaffolding** (npm workspaces, Node 22, TypeScript strict, ESLint with
  assertions banned, Prettier) mirroring the `auf` backend blueprint: controllers →
  use cases → repositories/services, Zod models parsed at every boundary.
- **`common/`**: shared HTTP toolkit (typed `Handler` builder with Zod-validated
  body/query/path and auth extractors, `RequestError`, `parseModels`, structured
  logger) — ported from `auf`.
- **`backend/`**: Express 5 session backend.
  - `POST /v1/accounts` registers a user's Telegram apiId/apiHash and mints a
    one-time bearer token (stored as SHA-256 hash only).
  - QR login flow on gramjs: `POST /v1/accounts/:id/qr` starts it,
    `GET /v1/accounts/:id/qr.png` renders the rotating `tg://login` token,
    `GET /v1/accounts/:id` polls, `POST /v1/accounts/:id/password` completes 2FA,
    `DELETE /v1/accounts/:id` logs out remotely and deletes the account.
  - Sessions and api_hash encrypted at rest (AES-256-GCM), persisted in Postgres via
    Kysely; migration `0001_init_accounts`.
  - Hosted auto-refreshing QR page at `/connect/:id` for clients that can't render
    inline images; OpenAPI 3.1 at `/openapi.json`; legacy `ai-plugin.json` manifest.
- **`mcp-server/`**: MCP stdio server for Claude with `telegram_connect`,
  `telegram_qr`, `telegram_status`, `telegram_password`, `telegram_logout`; returns
  the QR as inline image content; bundles to a single `build/index.js`.
- **Claude Code plugin**: `.claude-plugin/` manifests, `.mcp.json`, and a `telegram`
  skill describing the auth flow.
- **ChatGPT**: Custom GPT Actions guide and paste-ready GPT instructions.
- **Deploy**: docker-compose (Postgres 16 + backend), single-process constraint
  documented (in-flight QR logins are in-memory).
