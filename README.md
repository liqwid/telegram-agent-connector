# Telegram Agent Connector

Open-source connector that lets AI assistants — Claude (via MCP) and ChatGPT (via
Custom GPT Actions) — link a user's **Telegram account** with a QR-code login, the same
way Telegram Desktop links a device.

The first release covers authentication end to end:

- The operator configures one Telegram application (`TELEGRAM_API_ID`/
  `TELEGRAM_API_HASH` from [my.telegram.org/apps](https://my.telegram.org/apps)) as
  backend secrets — end users are never asked for credentials.
- The assistant shows a **QR code in the chat** (inline image for Claude, hosted
  auto-refreshing page for ChatGPT).
- The user scans it from the Telegram app; 2FA cloud passwords are supported.
- The resulting session lives on a **self-hosted backend**, encrypted at rest, scoped
  per account by a bearer token — so any chat client with the plugin can reuse it.

```
┌────────────┐   MCP (stdio)    ┌────────────┐   REST    ┌──────────────┐  MTProto  ┌──────────┐
│   Claude    │ ───────────────▶│ mcp-server │ ─────────▶│   backend    │──────────▶│ Telegram │
└────────────┘                  └────────────┘           │ Express 5 +  │           └──────────┘
┌────────────┐        Actions (OpenAPI)                  │ gramjs +     │
│  ChatGPT    │ ────────────────────────────────────────▶│ Postgres     │
└────────────┘                                           └──────────────┘
```

## Repository layout

| Path              | What it is                                                        |
| ----------------- | ----------------------------------------------------------------- |
| `backend/`        | Session backend: Express 5, TypeScript, Kysely + Postgres, gramjs |
| `common/`         | Shared HTTP handler/validation/logging toolkit                    |
| `mcp-server/`     | MCP server for Claude (stdio, bundled to a single file)           |
| `skills/`         | Claude Code skill describing the auth flow                        |
| `chatgpt/`        | Custom GPT (Actions) setup guide + instructions                   |
| `.claude-plugin/` | Claude Code plugin + marketplace manifests                        |
| `deploy/`         | Production deploy: pm2, nginx (Cloudflare origin), ufw, bootstrap |

## Quick start

### 1. Run the backend

```bash
cp .env.example .env       # set TELEGRAM_API_ID + TELEGRAM_API_HASH
                           # (my.telegram.org/apps) and ENCRYPTION_SECRET
                           # (openssl rand -base64 32)
docker compose up -d       # Postgres + backend on :8300
```

Local development instead of Docker: `npm install`, start Postgres, set
`DATABASE_URL` in `.env`, then `npm run migrate -w backend && npm run dev`.

The backend must run as a **single process** — in-flight QR logins live in memory.

### 2. Connect Claude

**Easiest — hosted connector (no local software).** Open the backend's landing
page (`https://<your-backend>/`), click **Create my connector**, and paste the
personal URL it gives you into Claude:

- **claude.ai / Claude Desktop**: Settings → Connectors → Add custom connector
- **Claude Code**: `claude mcp add --transport http telegram https://<your-backend>/mcp/<token>`

The URL embeds your bearer token — treat it like a password.

**Alternative — local stdio bridge** (works fully offline against a local
backend, or if you prefer not to expose the MCP endpoint):

```bash
npm install && npm run build          # bundles mcp-server/build/index.js
claude mcp add telegram-connector \
  --env TELEGRAM_CONNECTOR_URL=https://<your-backend> \
  -- node "$(pwd)/mcp-server/build/index.js"
```

Or install the repo as a Claude Code plugin (it ships `.claude-plugin/`,
`.mcp.json` and a skill): `/plugin marketplace add <owner>/telegram-agent-connector`.

Either way, then just ask Claude to _"connect my Telegram account"_ — it
renders the QR in chat and polls until you've scanned it.

### 3. Connect ChatGPT

Deploy the backend behind HTTPS, then create a Custom GPT whose Action imports
`https://<your-backend>/openapi.json`. Full walkthrough: [`chatgpt/README.md`](chatgpt/README.md).

## API surface

| Endpoint                         | Purpose                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| `POST /v1/accounts`              | Create an account slot → `accountId` + bearer token           |
| `POST /v1/accounts/:id/qr`       | Start/restart a QR login                                      |
| `GET /v1/accounts/:id/qr.png`    | Current QR as PNG (token rotates ~30s)                        |
| `GET /v1/accounts/:id`           | Status: `waiting_scan` / `password_needed` / `authorized` / … |
| `POST /v1/accounts/:id/password` | Complete a 2FA login                                          |
| `DELETE /v1/accounts/:id`        | Log out remotely + delete the account                         |
| `GET /connect/:id?token=…`       | Hosted auto-refreshing QR page                                |
| `POST /mcp/:token`               | Hosted MCP connector for Claude (Streamable HTTP)             |
| `GET /`                          | Onboarding page — creates a personal connector URL            |
| `GET /openapi.json`              | OpenAPI 3.1 (GPT Actions import)                              |

## Security model

- **Session strings are AES-256-GCM encrypted at rest** with `ENCRYPTION_SECRET`; a
  stored session is equivalent to a logged-in device, treat the secret accordingly.
- The Telegram application credentials (`TELEGRAM_API_ID`/`TELEGRAM_API_HASH`) are
  deployment-level env secrets — never stored per user, never asked for in chat.
- Bearer tokens are returned once and stored only as SHA-256 hashes; lookups compare
  in constant time.
- The MCP server keeps only `{accountId, accountToken}` locally
  (`~/.telegram-agent-connector.json`, mode 600) — never the api_hash or session.
- Disconnecting logs the device out on Telegram's side (best effort) and deletes the row.

## Production deployment

Push-to-deploy via GitHub Actions + Doppler + SSH (pm2 behind a
Cloudflare-fronted nginx origin) — see [`deploy/README.md`](deploy/README.md).

## Development

```bash
npm install
npm run ts      # typecheck all workspaces
npm run lint
npm run test
npm run dev     # backend with tsx watch
```

## Roadmap

Authentication is the foundation; next up are the actual Telegram features driven
through the stored sessions: reading dialogs, sending messages, search.

## License

MIT — see [LICENSE](LICENSE).
