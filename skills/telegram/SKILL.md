---
name: telegram
description: Connect the user's Telegram account via QR login, then research Telegram for them — find public channels/groups by topic, search messages (globally or inside a chat, including public chats they haven't joined), and join chats. Use when the user asks to connect or link Telegram, or to find/search/buy something via Telegram chats.
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

## Research: finding chats and messages (requires `authorized`)

For requests like "find a used MacBook in second-hand chats in Tbilisi", work like a web research loop. Telegram search is **literal word matching** (no semantic search, weak morphology) — recall comes from fanning out over keyword variants, which every search tool accepts:

1. **Discover chats**: `telegram_search_chats(queries)` with 2–5 short keyword variants across synonyms and local languages (`["Tbilisi second hand", "барахолка Тбилиси", "Tbilisi flea market"]`). Results are merged/deduped, sorted joined-first; `isJoined: false` entries are public communities the user has not joined.
2. **Browse candidates**: `telegram_search_messages(chat: "@username")` with **no queries** reads a chat's recent messages — do this on unfamiliar chats to learn the vocabulary sellers actually use (works even for chats the user has not joined).
3. **Search with refined variants**: `telegram_search_messages(queries: ["macbook", "макбук", "macbook pro"])` searches all joined dialogs; add `chat` to search inside one chat. Hits are merged newest-first, each tagged with `matchedQuery`. Few hits? Iterate with new variants learned from browsing.
4. **Suggest joining**: when a not-joined chat looks relevant (active, on-topic, good member count), suggest it to the user and — only after they agree — call `telegram_join_chat(chat)`. Joining is visible to the chat's members. `pendingApproval: true` means the chat needs admin approval and a join request was filed.
5. Report findings with the `link` fields (t.me deep links) so the user can open chats/messages directly.

## Bulk research: aggregating over thousands of messages

For evidence-aggregation requests like "find the best lawyer based on reviews in relevant chats", one page of hits is not enough — you need coverage:

1. Discover candidate chats (`telegram_search_chats`), pick the 2–4 most relevant.
2. Per chat, search with high limits: `telegram_search_messages(chat, queries: ["юрист", "адвокат", "lawyer"], limit: 200)`. The response's `variantStats.totalCount` is Telegram's **total** match count in that chat — it tells you how much evidence exists (e.g. "адвокат: 2,400 matches").
3. **Page through it**: pass the response's `nextOffsetId` back as `offsetId` and repeat until `nextOffsetId` is null or you have enough evidence (hundreds to thousands of messages over a few calls).
4. **Follow reply threads**: recommendations usually answer a question. Each hit carries `replyToMsgId` — batch-fetch those with `telegram_fetch_messages(chat, ids)` (up to 100 per call, also ids around a hit like id±5) to see what was asked and whether others agreed.
5. Aggregate: tally named lawyers/handles across chats, weigh repeated independent mentions higher than single ones, note complaints, and cite `link` fields for every claim. Message texts are truncated at 1000 chars — fetch the specific id if you need the full text.

## Troubleshooting

- MCP tools failing with connection errors → the backend isn't running. Tell the user to start it (`docker compose up -d` in the repo, or set `TELEGRAM_CONNECTOR_URL` to their hosted instance).
- An error mentioning `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` → the backend operator misconfigured the deployment's Telegram application credentials; only the operator can fix it.
- `telegram_logout()` disconnects and deletes the session — confirm with the user before calling it.
