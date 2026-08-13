# Using the connector from ChatGPT

ChatGPT's original plugin system was retired in 2024; the supported path today is a
**Custom GPT with Actions**. The backend serves everything needed for both:

- `GET /openapi.json` — OpenAPI 3.1 schema
- `GET /.well-known/ai-plugin.json` — legacy plugin manifest (kept for compatible clients)

## Set up a Custom GPT

1. Use the hosted service (`https://tgagent.grownow.tech`) — or deploy the backend
   somewhere ChatGPT can reach over **HTTPS** and set `PUBLIC_BASE_URL` to that URL
   (Actions cannot call `localhost`).
2. In ChatGPT: **Explore GPTs → Create → Configure → Create new action**, and set the
   schema import URL to `https://<your-backend>/openapi.json`. Authentication: **None**
   (per-account bearer tokens are created at runtime by the flow itself).
3. Paste the contents of [`gpt-instructions.md`](./gpt-instructions.md) into the GPT's
   **Instructions** field.

## How the QR reaches the user

GPT Actions can't reliably render arbitrary image bytes inline, so for ChatGPT the flow
uses the backend's hosted QR page: the `POST /v1/accounts/{id}/qr` response contains a
`connect_page` URL. The GPT substitutes the account token into it and sends the user the
link; the page shows the QR, auto-refreshes it as Telegram rotates the token, and flips
to a success message once the account is authorized.
