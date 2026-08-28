import { HTTPStatus } from "common";
import type { Request } from "express";

import { accountPathSchema } from "@/controllers/accounts";
import { accountHandler } from "@/utils/handler";

/**
 * Hosted QR page — the fallback for clients that cannot render image bytes
 * inline (ChatGPT Actions). Auto-refreshes the QR as Telegram rotates the
 * token, takes the 2FA password when the account has one, and flips to a
 * success message once authorized.
 *
 * Why the password is taken HERE and not only in the chat: dictating a
 * Telegram cloud password to an assistant writes it into a conversation
 * transcript held by the model provider. This form posts it straight to the
 * backend, so the assistant never sees it. The chat path stays as a fallback
 * for clients that cannot open a link; its tool description now says to offer
 * this page first (owner decision, 2026-08-26).
 */

/**
 * A password field is only served over a channel that protects it. nginx sets
 * `x-forwarded-proto` in front of the backend; a direct local run is trusted
 * because nothing leaves the machine. Anything else gets the QR page without
 * the form and is told to use the chat instead — a missing form is a nuisance,
 * a cloud password in cleartext on the wire is not recoverable.
 *
 * The header is trustworthy in the hosted deployment specifically: ufw admits
 * 80/443 from Cloudflare's ranges only, and Cloudflare overwrites
 * `X-Forwarded-Proto` with the VISITOR's scheme — which is why the vhost
 * deliberately passes it through instead of substituting `$scheme` (that would
 * report the Cloudflare-to-origin hop and hide the form from an https
 * visitor). ⚠️ A self-hoster who puts the backend behind a proxy that forwards
 * client headers verbatim gets a header the client can forge, and this check
 * degrades to decoration. Anyone doing that must terminate TLS or set the
 * header themselves; `deploy/README.md` says so.
 */
export const isPasswordSafeChannel = (
  proto: string | null,
  hostname: string,
): boolean =>
  proto === "https" ||
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "::1";

const forwardedProto = (request: Request): string | null => {
  const header = request.header("x-forwarded-proto");
  // A proxy chain sets a comma-separated list; the client-facing one is first.
  return header ? (header.split(",")[0]?.trim().toLowerCase() ?? null) : null;
};

/** Exported for tests: the form's presence is the thing worth asserting. */
export const connectPageHtml = (
  accountId: string,
  passwordForm: boolean,
): string =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Telegram</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; flex-direction: column;
         align-items: center; gap: 1rem; padding: 2rem; background: #f5f7fa; color: #1a1a2e; }
  img { width: 280px; height: 280px; background: #fff; border-radius: 12px;
        box-shadow: 0 2px 12px rgba(0,0,0,.12); padding: 12px; }
  #status { font-weight: 600; }
  form { display: none; flex-direction: column; gap: .75rem; width: min(320px, 100%);
         background: #fff; padding: 1.25rem; border-radius: 12px;
         box-shadow: 0 2px 12px rgba(0,0,0,.12); }
  input { font-size: 1rem; padding: .6rem .7rem; border: 1px solid #c9d2e0;
          border-radius: 8px; }
  button { font-size: 1rem; padding: .6rem; border: 0; border-radius: 8px;
           background: #2b7cd3; color: #fff; font-weight: 600; cursor: pointer; }
  button[disabled] { background: #9bb6d6; cursor: default; }
  #hint, #formError { font-size: .9rem; }
  #formError { color: #b3261e; min-height: 1.2em; }
</style>
</head>
<body>
<h2>Link your Telegram account</h2>
<p>Telegram app &rarr; Settings &rarr; Devices &rarr; <b>Link Desktop Device</b>, then scan:</p>
<img id="qr" alt="Telegram login QR code">
<p id="status">Waiting for scan&hellip;</p>
<form id="pwForm" autocomplete="on">
  <label for="pw"><b>Two-step verification</b><br>Enter your Telegram cloud password.</label>
  <p id="hint"></p>
  <input id="pw" type="password" name="password" autocomplete="current-password"
         placeholder="Cloud password" required>
  <button id="pwSubmit" type="submit">Confirm</button>
  <p id="formError" role="alert"></p>
</form>
<script>
  const base = "/v1/accounts/${accountId}";
  const token = new URLSearchParams(location.search).get("token");
  const passwordForm = ${passwordForm ? "true" : "false"};
  const qrImage = document.getElementById("qr");
  const statusText = document.getElementById("status");
  const form = document.getElementById("pwForm");
  const hint = document.getElementById("hint");
  const formError = document.getElementById("formError");
  const submit = document.getElementById("pwSubmit");

  const refreshQr = () => {
    qrImage.src = base + "/qr.png?token=" + encodeURIComponent(token) + "&t=" + Date.now();
  };

  const authorized = () => {
    statusText.textContent = "✅ Connected! You can close this page.";
    qrImage.remove();
    form.style.display = "none";
    clearInterval(timer);
  };

  // Rendered once: after this the QR is dead and only the password matters.
  const askForPassword = (passwordHint) => {
    if (form.style.display === "flex") return;
    qrImage.remove();
    if (!passwordForm) {
      statusText.textContent =
        "🔐 Scanned. This page is not served over HTTPS, so it will not ask " +
        "for your password. Reopen this link over https, or enter the " +
        "password back in the chat.";
      clearInterval(timer);
      return;
    }
    statusText.textContent = "🔐 Scanned. One more step:";
    hint.textContent = passwordHint ? "Telegram's hint: " + passwordHint : "";
    form.style.display = "flex";
    document.getElementById("pw").focus();
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = document.getElementById("pw").value;
    if (!password) return;
    submit.disabled = true;
    formError.textContent = "";
    statusText.textContent = "Checking with Telegram…";
    try {
      // The token goes in the header, not the query string: this request
      // carries a password, and one credential per access log line is enough.
      const response = await fetch(base + "/password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ password }),
      });
      const result = response.ok ? await response.json() : null;
      if (result && result.status === "authorized") {
        authorized();
        return;
      }
      // Telegram re-requests the password when it was wrong; any other state
      // means the login window died while we were waiting.
      formError.textContent =
        result && result.status === "password_needed"
          ? "That password was not accepted. Try again."
          : "The login expired — ask the assistant to start a new QR login.";
      statusText.textContent = "🔐 Scanned. One more step:";
      document.getElementById("pw").select();
    } catch {
      formError.textContent = "Could not reach the server. Try again.";
    } finally {
      submit.disabled = false;
    }
  });

  refreshQr();
  const timer = setInterval(async () => {
    // Stop rotating a QR nobody can scan any more.
    if (form.style.display !== "flex") refreshQr();
    const response = await fetch(base + "?token=" + encodeURIComponent(token));
    if (!response.ok) return;
    const { status, passwordHint } = await response.json();
    if (status === "authorized") {
      authorized();
    } else if (status === "password_needed") {
      askForPassword(passwordHint);
    } else if (status === "expired" || status === "error") {
      statusText.textContent = "QR expired — ask the assistant to restart the login.";
      form.style.display = "none";
      clearInterval(timer);
    }
  }, 3000);
</script>
</body>
</html>
`;

export const connectPageHandler = accountHandler
  .parse({ path: accountPathSchema })
  .handleAuthorized(async ({ auth, request }) => ({
    status: HTTPStatus.OK,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: connectPageHtml(
      auth.account.id,
      isPasswordSafeChannel(forwardedProto(request), request.hostname),
    ),
  }));
