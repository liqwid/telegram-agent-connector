---
name: telegram
description: Connect the user's Telegram account via QR login. Use when the user asks to connect, authenticate, log in to, or link Telegram, or asks to do anything with Telegram while not yet connected.
---

# Connecting a Telegram account

This plugin talks to a self-hosted session backend through the `telegram-connector` MCP tools. Authorization is per account: the backend keeps the Telegram session, and local credentials (`~/.telegram-agent-connector.json`) identify which backend account belongs to this user. The Telegram application credentials (api_id/api_hash) are backend configuration — never ask the user for them.

## Flow

1. **Check first**: call `telegram_status()`. If it returns `authorized`, say so and stop — don't re-authenticate.
2. **Start the login**: call `telegram_connect()` — no arguments needed. It returns a QR code image — it will be shown in chat. Tell the user: open Telegram on their phone → **Settings → Devices → Link Desktop Device** → scan the code.
3. **Poll**: call `telegram_status()` every ~5–10 seconds (or when the user says they scanned it):
   - `waiting_scan` — still waiting. The QR rotates ~every 30s; if the user says it expired, call `telegram_qr()` to show a fresh one.
   - `password_needed` — the account has 2FA. Ask the user for their Telegram cloud password and call `telegram_password(password)`. Never store or repeat the password.
   - `authorized` — done. Report the connected Telegram user (name/username) back.
   - `expired` / `error` — restart with `telegram_connect()`.
4. If the QR image can't be displayed in this client, the `telegram_connect` result includes a fallback browser link — give the user that link instead.

## Troubleshooting

- MCP tools failing with connection errors → the backend isn't running. Tell the user to start it (`docker compose up -d` in the repo, or set `TELEGRAM_CONNECTOR_URL` to their hosted instance).
- An error mentioning `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` → the backend operator misconfigured the deployment's Telegram application credentials; only the operator can fix it.
- `telegram_logout()` disconnects and deletes the session — confirm with the user before calling it.
