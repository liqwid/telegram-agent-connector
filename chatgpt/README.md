# Connect ChatGPT — step by step

> **Publishing for other people?** See [Publish one GPT for everyone
> (OAuth)](#publish-one-gpt-for-everyone-oauth) at the bottom — with OAuth, users
> authenticate once and their Telegram link survives across chats. The walkthrough
> below (Authentication: None) is the quick personal setup; its limitation is that
> each new conversation starts a fresh account and needs a new QR scan.

What you're building: a **Custom GPT** with one Action that talks to the connector
backend. Takes about 3 minutes. Requirements: a paid ChatGPT plan (creating GPTs
needs Plus/Pro/Team) and nothing else — no code, no keys.

The steps below use the hosted service (`tgagent.grownow.tech`). Self-hosting? Just
replace the domain with your own (it must be public HTTPS — Actions cannot reach
`localhost`).

## 1. Create the GPT

1. Go to <https://chatgpt.com/gpts/editor> (or: ChatGPT sidebar → **GPTs** →
   **+ Create**).
2. Click the **Configure** tab at the top (ignore the chat-style "Create" tab).
3. **Name**: `Telegram` (anything you like).

## 2. Paste the instructions

Copy the whole block from [`gpt-instructions.md`](./gpt-instructions.md) (the part
below the `---` line) into the big **Instructions** field.

## 3. Add the Action

1. Scroll to the bottom → under **Actions**, click **Create new action**.
2. Click **Import from URL**, paste:
   ```
   https://tgagent.grownow.tech/openapi.json
   ```
   and click **Import**. Six operations appear (createAccount, startQrLogin, …).
3. **Authentication**: leave as **None** (the flow creates its own per-user token).
4. Go back (arrow at top) — no other fields are needed. Privacy policy URL is only
   required if you later share the GPT publicly; for personal use leave it empty.

## 4. Save and use

1. Click **Create** (top right) → share option **Only me** → **Save**.
2. Open your new GPT and type: **connect my Telegram account**.
3. The first time it calls the backend, ChatGPT shows an
   "Allow tgagent.grownow.tech" confirmation — click **Allow** (or "Always allow").
4. The GPT sends you a link — open it, and scan the QR with the Telegram app:
   **Settings → Devices → Link Desktop Device**. If your account has a 2FA cloud
   password, the GPT will ask for it after the scan.

Done — the GPT reports which Telegram account is connected.

## Troubleshooting

- **Schema import fails** — make sure the URL is exactly
  `https://tgagent.grownow.tech/openapi.json`; paste the error text into an issue if
  it persists.
- **"Allow" prompt loops or calls fail** — check the backend is reachable:
  <https://tgagent.grownow.tech/healthz> should show `{"ok":true}`.
- **QR expired** — just tell the GPT; it restarts the login and sends a fresh link
  (the QR page also refreshes itself automatically).

## Publish one GPT for everyone (OAuth)

The backend is a full OAuth 2.1 server, and GPT Actions support OAuth — this is how
you turn the personal recipe into a public GPT with durable per-user auth:

ChatGPT regenerates the callback URL every time a GPT's OAuth settings change, so
the order matters: register a client first (credentials never change), configure
the GPT, then point the client's redirect at whatever callback ChatGPT settled on.

1. Register an OAuth client (placeholder redirect — it gets corrected in step 4):
   ```bash
   curl -X POST https://tgagent.grownow.tech/oauth/register \
     -H 'content-type: application/json' \
     -d '{
       "clientName": "Telegram GPT",
       "redirectUris": ["https://chat.openai.com/aip/pending/oauth/callback"],
       "tokenEndpointAuthMethod": "client_secret_basic"
     }'
   ```
   The response contains `client_id`, `client_secret`, and a
   `registration_access_token` — all shown once; save all three.
2. Create the GPT as above, and in its Action switch **Authentication** to
   **OAuth**:
   - Client ID / Client Secret: from step 1
   - Authorization URL: `https://tgagent.grownow.tech/oauth/authorize`
   - Token URL: `https://tgagent.grownow.tech/oauth/token`
   - Scope: `telegram`
   - Token exchange method: Basic authorization header
3. **Save/Update the GPT.** The Action panel now displays the final Callback URL —
   copy it.
4. Point the client at that exact callback (repeat this step any time you edit the
   GPT's OAuth settings and the callback rotates):
   ```bash
   curl -X PUT https://tgagent.grownow.tech/oauth/register/<CLIENT_ID> \
     -H 'content-type: application/json' \
     -H 'Authorization: Bearer <REGISTRATION_ACCESS_TOKEN>' \
     -d '{"redirectUris": ["<CALLBACK URL FROM STEP 3>"]}'
   ```
5. Use [`gpt-instructions-oauth.md`](./gpt-instructions-oauth.md) as the GPT's
   instructions — the OAuth operations (`getMyStatus`, `startMyQrLogin`,
   `submitMyPassword`, `disconnectMe`), no token juggling.
6. Test from a normal chat (not the editor preview — OAuth sign-in does not work
   there), then share the GPT (**Anyone with the link** or the GPT Store; public
   listing requires a privacy policy URL — use
   `https://tgagent.grownow.tech/privacy`).

Users who open the GPT get ChatGPT's standard "Sign in" prompt → this backend's
approval page → then the QR-scan flow. Their session persists across conversations.

## Note on the legacy plugin manifest

The backend also serves `/.well-known/ai-plugin.json` for pre-2024 plugin-compatible
clients; the Custom GPT route above is the supported path today.
