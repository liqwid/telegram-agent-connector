# Changelog

## Unreleased

- **The landing page is served in production at `/`.** `deploy/landing/index.html`
  (the page from the `landing` branch) is installed to `/var/www/tac-landing/`
  by `remote-deploy.sh` and served by two exact-match nginx locations, so `/`
  stops being the backend's plain onboarding page — which called the product
  "Telegram Agent Connector" and styled its button in Telegram's brand blue
  `#2481cc`, both forbidden by Telegram API ToS 2.3 and 2.4. Every API path is
  untouched; `remote-deploy.sh` now asserts, through nginx after the reload,
  that `/` really returns the landing (a 200 alone proves nothing — the backend
  answers there too when the location block is missing).
  Not GitHub Pages: a hostname resolves to one server, and pointing
  `tgagent.grownow.tech` at Pages would remove `/mcp`, `/oauth/*` and
  `/.well-known/openai-apps-challenge` — which is exactly what OpenAI's and
  Anthropic's domain verification fetches.
  The bundled page had no identity of its own: it replaces `documentElement`
  with a payload whose `<head>` carried no `<title>`, so the tab showed the
  bare URL and the pre-unpack placeholder read "Bundled Page". A title, a
  description and an inline SVG favicon are now injected into the payload head
  in the file itself. ⚠️ **Regenerating the bundle drops that edit** — re-apply
  it, or the production tab goes back to reading "Bundled Page".
  The first deploy of this failed on its own health assertion while serving the
  page correctly: `printf | grep -q` inverts under `set -o pipefail`, because
  grep exits on the first match, closes the pipe, and printf dies of SIGPIPE —
  so a successful match returned 141. Matched with `case` now. The lesson is
  the check, not the shell: an assertion that has never been run against a
  *passing* input is not yet a check.

- **Chat discovery & research.** Authorized accounts can now answer requests
  like "find a used MacBook in second-hand chats in Tbilisi": public
  channel/group discovery by topic keywords (`contacts.Search` — includes
  chats the user has *not* joined, flagged `isJoined: false` so assistants can
  suggest joining them), message search (global across joined dialogs via
  `messages.SearchGlobal`, or inside one chat via `messages.Search` — public
  chats are searchable without joining), and joining chats by @username or
  invite link (approval-gated chats report `pendingApproval`). Exposed three
  ways: REST (`GET /v1/{accounts/:id,me}/chats/search`,
  `GET …/messages/search`, `POST …/chats/join`, documented in the OpenAPI
  spec for GPT Actions), hosted MCP connector, and the local stdio bridge
  (`telegram_search_chats`, `telegram_search_messages`, `telegram_join_chat` —
  join tool instructs models to confirm with the user first). Stored sessions
  are exercised by short-lived per-request clients
  (`services/telegramSession`), translating dead sessions to a 409
  "reconnect" error and flood waits / other RPC failures to 502.
  Because Telegram search is literal word matching (no semantics, weak
  morphology), all search endpoints do web-search-style research instead of
  single exact queries: they fan out over up to 5 keyword variants (repeated
  or comma-separated `q` on REST, `queries[]` on MCP — the LLM supplies
  synonym/language variants), merge and dedupe the results (chats
  joined-first; messages newest-first, each hit tagged `matchedQuery`), and
  message search with a `chat` but no query browses the chat's recent history
  (`messages.GetHistory`) so models can learn a community's vocabulary before
  searching it. Tool/spec descriptions teach the loop: discover → browse →
  refine variants → report t.me links.
  Chat-scoped search/browse is built for bulk aggregation research ("best
  lawyer based on reviews in relevant chats"): the backend pages internally
  (100/RPC, sequentially per variant to stay flood-safe) up to `limit=300`
  messages per variant per call, reports `variantStats` with Telegram's total
  match count per variant, and returns a `nextOffsetId` cursor
  (`offsetId` request param) so callers walk thousands of messages across
  successive calls; hit texts are truncated at 1000 chars to keep digests
  compact. Each hit carries `replyToMsgId`, and a new fetch-by-id operation
  (`GET /v1/{accounts/:id,me}/messages/get`, MCP `telegram_fetch_messages`,
  ≤100 ids/call) pulls reply-thread context — the question a recommendation
  answers — for public chats without joining.

- **Client updates (RFC 7592-style).** ChatGPT regenerates a GPT's OAuth
  callback on every settings edit, making exact-match registration circular.
  Registration now returns a one-time `registration_access_token` +
  `registration_client_uri`, and `PUT /oauth/register/:clientId` (bearer:
  that token) updates the client's redirect URIs — so credentials stay
  stable while the callback rotates, and redirect validation remains exact
  match (a briefly-considered wildcard approach was rejected: it could not
  distinguish one GPT's callback from another's). Migration
  `0005_client_registration_tokens`.

- **OAuth 2.1 authorization server** — the unlock for real-user distribution
  (Anthropic connector directory, published GPTs, ChatGPT Apps). Discovery
  metadata (RFC 8414 + RFC 9728), open dynamic client registration (RFC 7591,
  public PKCE-S256 clients and confidential secret clients), consent page,
  authorization-code + refresh-token grants with rotation; codes/tokens/secrets
  stored hashed (migration `0004_oauth`). The bare `POST /mcp` endpoint now
  does bearer auth and advertises the auth server via `WWW-Authenticate`, so
  pasting `https://…/mcp` into Claude or ChatGPT triggers the OAuth flow
  automatically; the personal token URLs remain as a legacy fallback. New
  OAuth-scoped `/v1/me` endpoints (status/qr/password/disconnect) added to the
  OpenAPI spec with an oauth2 security scheme for published GPTs. QR page/image
  links now carry short-lived HMAC page tokens instead of raw account tokens.
  Landing page rewritten around the single `/mcp` URL; ChatGPT guide gained a
  "publish one GPT for everyone" OAuth walkthrough.

- **OpenAPI import fixes for ChatGPT Actions.** Zod's `"$schema"` stamp is now
  stripped from request-body schemas and the `qr.png` response declares a
  proper binary schema — both tripped ChatGPT's Actions schema validator on
  import. Operation summaries are also kept under the importer's 300-char cap
  (long research guidance moved to `description`), enforced by a spec test.

- **QR page link in every MCP response.** claude.ai does not render image tool
  content, so the inline QR was invisible there. All scan-related tool
  responses (`telegram_connect`, `telegram_qr`, and `telegram_status` while
  `waiting_scan`) now lead with the hosted QR-page link (auto-refreshing) and
  the server instructions tell the model to always hand the user that link
  instead of assuming the attached image is visible. The inline PNG stays as a
  bonus for clients that do render it. Applied to both the hosted connector
  and the local stdio bridge; `telegram_status` also gained per-status
  guidance text.

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
