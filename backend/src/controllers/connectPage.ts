import { HTTPStatus } from "common";

import { accountPathSchema } from "@/controllers/accounts";
import { accountHandler } from "@/utils/handler";

/**
 * Hosted QR page — the fallback for clients that cannot render image bytes
 * inline (ChatGPT Actions). Auto-refreshes the QR as Telegram rotates the
 * token and flips to a success message once the account is authorized.
 */
const connectPageHtml = (accountId: string): string => `<!doctype html>
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
</style>
</head>
<body>
<h2>Link your Telegram account</h2>
<p>Telegram app &rarr; Settings &rarr; Devices &rarr; <b>Link Desktop Device</b>, then scan:</p>
<img id="qr" alt="Telegram login QR code">
<p id="status">Waiting for scan&hellip;</p>
<script>
  const base = "/v1/accounts/${accountId}";
  const token = new URLSearchParams(location.search).get("token");
  const qrImage = document.getElementById("qr");
  const statusText = document.getElementById("status");
  const refreshQr = () => {
    qrImage.src = base + "/qr.png?token=" + encodeURIComponent(token) + "&t=" + Date.now();
  };
  refreshQr();
  const timer = setInterval(async () => {
    refreshQr();
    const response = await fetch(base + "?token=" + encodeURIComponent(token));
    if (!response.ok) return;
    const { status } = await response.json();
    if (status === "authorized") {
      statusText.textContent = "✅ Connected! You can close this page.";
      qrImage.remove();
      clearInterval(timer);
    } else if (status === "password_needed") {
      statusText.textContent = "🔐 Scanned. Enter your 2FA password back in the chat.";
      qrImage.remove();
      clearInterval(timer);
    } else if (status === "expired" || status === "error") {
      statusText.textContent = "QR expired — ask the assistant to restart the login.";
      clearInterval(timer);
    }
  }, 3000);
</script>
</body>
</html>
`;

export const connectPageHandler = accountHandler
  .parse({ path: accountPathSchema })
  .handleAuthorized(async ({ auth }) => ({
    status: HTTPStatus.OK,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: connectPageHtml(auth.account.id),
  }));
