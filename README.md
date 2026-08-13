# Telegram Agent Connector

Open-source connector that lets AI assistants — Claude (via MCP) and ChatGPT (via
Custom GPT Actions) — link a user's **Telegram account** with a QR-code login, the same
way Telegram Desktop links a device.

- No credentials asked in chat — you just scan a **QR code** (shown inline for Claude,
  on a hosted auto-refreshing page for ChatGPT); 2FA cloud passwords are supported.
- The Telegram session lives on the backend, encrypted at rest, scoped per account by
  a bearer token — any chat client with the connector can reuse it.
- Nothing to install for users: Claude connects over hosted MCP (Streamable HTTP),
  ChatGPT over Actions.

```
┌──────────┐  MCP (hosted, Streamable HTTP     ┌──────────────┐  MTProto  ┌──────────┐
│  Claude  │────── or local stdio bridge) ────▶│   backend    │──────────▶│ Telegram │
└──────────┘                                   │ Express 5 +  │           └──────────┘
┌──────────┐        Actions (OpenAPI)          │ gramjs +     │
│ ChatGPT  │──────────────────────────────────▶│ Postgres     │
└──────────┘                                   └──────────────┘
```

## Option A — use the hosted service

The hosted service runs at **[tgagent.grownow.tech](https://tgagent.grownow.tech)**.
Your Telegram session is stored there (encrypted); if you'd rather keep sessions on
your own infrastructure, see [Option B](#option-b--self-host).

### Claude

1. Open <https://tgagent.grownow.tech> and click **Create my connector** — you get a
   personal connector URL. It embeds your bearer token: **treat it like a password**,
   it's shown only once.
2. Add it to Claude:
   - **claude.ai / Claude Desktop**: Settings → Connectors → Add custom connector →
     paste the URL.
   - **Claude Code**:
     ```bash
     claude mcp add --transport http telegram https://tgagent.grownow.tech/mcp/<token>
     ```
     (Terminal-only alternative, no browser needed:
     `TOKEN=$(curl -s -X POST https://tgagent.grownow.tech/v1/accounts | jq -r .accountToken)`
     then use it in the command above.)
3. Ask Claude to _“connect my Telegram account”_ — it shows the QR; scan it from the
   Telegram app (**Settings → Devices → Link Desktop Device**).

### ChatGPT

Create a Custom GPT (**Explore GPTs → Create → Configure → Create new action**) whose
Action imports `https://tgagent.grownow.tech/openapi.json` (Authentication: None), and
paste [`chatgpt/gpt-instructions.md`](chatgpt/gpt-instructions.md) into its
Instructions. Full walkthrough: [`chatgpt/README.md`](chatgpt/README.md).

## Option B — self-host

### 1. Run the backend

```bash
git clone https://github.com/liqwid/telegram-agent-connector && cd telegram-agent-connector
cp .env.example .env       # set TELEGRAM_API_ID + TELEGRAM_API_HASH
                           # (my.telegram.org/apps) and ENCRYPTION_SECRET
                           # (openssl rand -base64 32)
docker compose up -d       # Postgres + backend on :8300
```

Local development instead of Docker: `npm install`, start Postgres, set
`DATABASE_URL` in `.env`, then `npm run migrate -w backend && npm run dev`.

The backend must run as a **single process** — in-flight QR logins live in memory.

For a production server there's a full push-to-deploy pipeline (GitHub Actions +
Doppler secrets + SSH, pm2 behind a Cloudflare-fronted nginx origin with automatic
Let's Encrypt TLS) — see [`deploy/README.md`](deploy/README.md).

### 2. Connect Claude / ChatGPT

Exactly as in Option A, with `https://<your-backend>` in place of
`tgagent.grownow.tech` (the landing page at `/` mints connector URLs on any
instance). For a localhost backend, ChatGPT and claude.ai can't reach you — use the
**local stdio bridge** instead:

```bash
npm install && npm run build          # bundles mcp-server/build/index.js
claude mcp add telegram-connector \
  --env TELEGRAM_CONNECTOR_URL=http://localhost:8300 \
  -- node "$(pwd)/mcp-server/build/index.js"
```

Or install the repo as a Claude Code plugin (it ships `.claude-plugin/`,
`.mcp.json` and a skill): `/plugin marketplace add liqwid/telegram-agent-connector`.

## Repository layout

| Path              | What it is                                                        |
| ----------------- | ----------------------------------------------------------------- |
| `backend/`        | Session backend: Express 5, TypeScript, Kysely + Postgres, gramjs |
| `common/`         | Shared HTTP handler/validation/logging toolkit                    |
| `mcp-server/`     | Local stdio MCP bridge for Claude (optional alternative)          |
| `skills/`         | Claude Code skill describing the auth flow                        |
| `chatgpt/`        | Custom GPT (Actions) setup guide + instructions                   |
| `.claude-plugin/` | Claude Code plugin + marketplace manifests                        |
| `deploy/`         | Production deploy: pm2, nginx (Cloudflare origin), ufw, bootstrap |

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
  in constant time. Token-bearing URLs are redacted from server logs.
- The local stdio bridge keeps only `{accountId, accountToken}` on your machine
  (`~/.telegram-agent-connector.json`, mode 600) — never the api_hash or session.
- Disconnecting logs the device out on Telegram's side (best effort) and deletes the row.

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
