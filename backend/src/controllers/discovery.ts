import { HTTPStatus } from "common";

import { env } from "@/env";
import { buildOpenApiSpec } from "@/openapi/spec";
import { renderQrPng } from "@/services/qrImage";
import { publicHandler } from "@/utils/handler";

/** Legacy ChatGPT plugin manifest; Custom GPT Actions use /openapi.json. */
export const aiPluginHandler = publicHandler.parse({}).handle(async () => ({
  status: HTTPStatus.OK,
  body: {
    schema_version: "v1",
    name_for_human: "Telegram Connector",
    name_for_model: "telegram_connector",
    description_for_human: "Connect your Telegram account via QR login.",
    description_for_model: [
      "Connects the user's Telegram account.",
      "To authenticate: 1) POST /v1/accounts (no input) and remember accountId and accountToken,",
      "2) POST /v1/accounts/{accountId}/qr with the token as a Bearer header,",
      "3) send the user the connectPage link from the response so they can scan the QR,",
      "4) poll GET /v1/accounts/{accountId} until status is 'authorized';",
      "if it is 'password_needed', ask for the 2FA password and POST it to /password.",
    ].join(" "),
    auth: { type: "none" },
    api: { type: "openapi", url: `${env.PUBLIC_BASE_URL}/openapi.json` },
    logo_url: `${env.PUBLIC_BASE_URL}/logo.png`,
    contact_email: env.CONTACT_EMAIL,
    legal_info_url: `${env.PUBLIC_BASE_URL}/legal`,
  },
}));

export const openApiHandler = publicHandler.parse({}).handle(async () => ({
  status: HTTPStatus.OK,
  body: buildOpenApiSpec(),
}));

/** Zero-asset logo: a QR code pointing at the project repository. */
export const logoHandler = publicHandler.parse({}).handle(async () => ({
  status: HTTPStatus.OK,
  headers: { "Content-Type": "image/png" },
  body: await renderQrPng(
    "https://github.com/tonypopov/telegram-agent-connector",
  ),
}));

const privacyPolicyHtml = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy Policy — Telegram Agent Connector</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 44rem; margin: 0 auto;
         padding: 2rem 1rem; line-height: 1.6; color: #1a1a2e; }
  h2 { margin-top: 1.6em; }
</style>
</head>
<body>
<h1>Privacy Policy — Telegram Agent Connector</h1>
<p>This service connects AI assistants (Claude, ChatGPT) to your Telegram account at
your request. It is open-source (MIT); this policy covers the hosted instance at
<b>${env.PUBLIC_BASE_URL}</b>, operated by the party named below.</p>

<h2>What we store</h2>
<ul>
  <li><b>Telegram session</b>: after you scan the QR code, the resulting session
      credential (equivalent to a logged-in device) is stored encrypted
      (AES-256-GCM). It exists so your assistant can act on your Telegram account
      when you ask it to.</li>
  <li><b>Account records</b>: a random account id, creation timestamps, and — once
      connected — your Telegram user id, username and first name, used to show you
      which account is linked.</li>
  <li><b>Authentication artifacts</b>: bearer tokens, OAuth client registrations,
      authorization codes and access/refresh tokens, all stored as SHA-256 hashes
      only.</li>
</ul>

<h2>What we do NOT store</h2>
<ul>
  <li>No Telegram message content, contact lists, or media are stored by this
      service. Requests are executed against Telegram live and results are returned
      to your assistant; the conversation itself lives with your assistant provider
      (Anthropic or OpenAI), under their policies.</li>
  <li>Your Telegram password is never stored: a 2FA cloud password, when required,
      is passed through to Telegram's login check and discarded.</li>
  <li>No analytics, advertising, or tracking of any kind.</li>
</ul>

<h2>Sharing</h2>
<p>Data is shared with no third parties, with two inherent exceptions: Telegram
itself (the service acts as a Telegram client on your behalf) and our hosting
infrastructure (server and database providers), which store the encrypted data
described above.</p>

<h2>Retention and deletion</h2>
<p>Everything is kept only while your account exists. Disconnecting (asking your
assistant to log out, or <i>disconnect</i> in the API) performs a remote Telegram
logout — the linked device disappears from your Telegram device list — and deletes
your account row, session, and OAuth tokens. You can also revoke the session at any
time from the Telegram app: Settings → Devices → terminate the session.</p>

<h2>Your controls</h2>
<ul>
  <li>Disconnect at any time (see above) — deletion is immediate.</li>
  <li>Self-host: the software is open source; you can run your own instance and be
      your own operator.</li>
</ul>

<h2>Contact</h2>
<p>Questions or deletion requests: <a href="mailto:${env.CONTACT_EMAIL}">${env.CONTACT_EMAIL}</a>.</p>

<h2>Terms</h2>
<p>Provided as-is under the MIT license. Use is subject to Telegram's Terms of
Service; automated abuse of Telegram (spam, scraping) is prohibited and will result
in disconnection.</p>
</body>
</html>`;

export const legalHandler = publicHandler.parse({}).handle(async () => ({
  status: HTTPStatus.OK,
  headers: { "Content-Type": "text/html; charset=utf-8" },
  body: privacyPolicyHtml(),
}));

export const healthHandler = publicHandler.parse({}).handle(async () => ({
  status: HTTPStatus.OK,
  body: { ok: true },
}));
