import { env } from "@/env";
import { legalPage } from "@/legal/layout";

/**
 * The privacy policy, as served on /privacy.
 *
 * Carried over from the single legal document it used to share with the terms,
 * with two substantive corrections made when it was split (2026-08-28):
 * the terms moved out to /terms, and the "what we do NOT store" list now
 * accounts for outgoing messages — the connector gained a send tool, so
 * message text now flows through this service in both directions and the
 * policy has to say what happens to it.
 */
export const privacyPolicyHtml = (): string =>
  legalPage(
    "privacy",
    "Privacy Policy",
    `<h1>Privacy Policy</h1>
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
  <li>The same applies in the other direction: when you ask your assistant to
      send a message, its text passes through this service to Telegram and is
      not written down here. What you sent remains in your own Telegram chat
      history, as with any Telegram client.</li>
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

<h2>Questions and deletion requests</h2>
<p>Write to <a href="mailto:${env.CONTACT_EMAIL}">${env.CONTACT_EMAIL}</a>, or see
the <a href="/contact">contact page</a>.</p>`,
  );
