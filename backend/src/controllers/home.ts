import { HTTPStatus } from "common";

import { env } from "@/env";
import { publicHandler } from "@/utils/handler";

/**
 * Onboarding landing page. With OAuth in place the connector URL is the same
 * for everyone (`/mcp`) — clients pop this backend's consent screen on first
 * use. The one-click personal token URL remains as an advanced fallback for
 * clients without OAuth support.
 */
const homePageHtml = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Telegram Agent Connector</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 0 auto;
         padding: 2rem 1rem; background: #f5f7fa; color: #1a1a2e; line-height: 1.5; }
  button { font-size: 1rem; padding: .6rem 1.2rem; border: 0; border-radius: 8px;
           background: #2481cc; color: #fff; cursor: pointer; }
  code, .url { background: #fff; border-radius: 6px; padding: .2rem .4rem;
               word-break: break-all; }
  .url { display: block; padding: .8rem; margin: .5rem 0; font-family: monospace; }
  textarea { width: 100%; font-family: monospace; font-size: .8rem; margin: .5rem 0;
             border: 1px solid #ccd; border-radius: 6px; padding: .5rem; }
  li { margin-bottom: .6rem; }
  .warn { color: #8a5300; background: #fff6e0; border-radius: 8px; padding: .6rem .8rem; }
  #result { display: none; }
  details { margin-top: 1rem; }
</style>
</head>
<body>
<h1>Telegram Agent Connector</h1>
<p>Link your Telegram account to Claude or ChatGPT. One URL, nothing to install —
you approve access once and scan a QR code from the Telegram app.</p>

<h2>Connector URL</h2>
<div class="url">${env.PUBLIC_BASE_URL}/mcp</div>

<h2>Claude</h2>
<ol>
  <li><b>claude.ai / Claude Desktop</b>: Settings → Connectors → <b>Add custom
      connector</b> → paste the URL above. Claude opens this site's approval page —
      click <b>Approve</b>.</li>
  <li><b>Claude Code</b>: <code>claude mcp add --transport http telegram ${env.PUBLIC_BASE_URL}/mcp</code></li>
  <li>Ask Claude: <i>“connect my Telegram account”</i> — open the link it sends and
      scan the QR (Telegram app → Settings → Devices → Link Desktop Device).</li>
</ol>

<h2>ChatGPT</h2>
<ol>
  <li>ChatGPT → <b>Settings → Apps &amp; Connectors</b> → enable <b>Developer mode</b>
      (under Advanced settings; needs a paid plan).</li>
  <li><b>Create</b> / <b>Add custom connector</b> → paste the URL above → OAuth —
      approve when prompted.</li>
  <li>In a new chat, enable the connector from the tools menu and say
      <i>“connect my Telegram account”</i>.</li>
</ol>
<details>
  <summary>Alternative without Developer mode: a Custom GPT with Actions</summary>
  <ol>
    <li>Open <a href="https://chatgpt.com/gpts/editor" target="_blank">chatgpt.com/gpts/editor</a>
        → <b>Configure</b> tab → name it <i>Telegram</i>.</li>
    <li>Copy this into the <b>Instructions</b> field:
      <textarea id="gpt-instructions" readonly rows="6"></textarea>
      <button id="copy-instructions" type="button">Copy instructions</button></li>
    <li><b>Actions</b> → <b>Create new action</b> → <b>Import from URL</b>:
      <div class="url">${env.PUBLIC_BASE_URL}/openapi.json</div>
      Authentication: <b>None</b> (or OAuth — see the repository's chatgpt/ guide).</li>
    <li><b>Create</b> → <i>Only me</i> → <b>Save</b>, then ask it to
        <i>“connect my Telegram account”</i> and click <b>Allow</b>.</li>
  </ol>
</details>

<details>
  <summary>Advanced: personal token URL (clients without OAuth)</summary>
  <p>Mints an account up front and embeds its bearer token in the URL.</p>
  <button id="create" type="button">Create my connector URL</button>
  <div id="result">
    <div class="url" id="mcp-url"></div>
    <p class="warn">⚠️ This URL is your key. Anyone who has it controls your Telegram
    link — treat it like a password. It is shown only here; copy it now.</p>
  </div>
</details>
<script>
  const gptInstructions = [
    "You connect the user's Telegram account through the Telegram Agent Connector API.",
    "No credentials are needed; the user only scans a QR code.",
    "1. If you don't have an accountId/accountToken from earlier in this conversation, call createAccount (no input) and remember both. Send the token as 'Authorization: Bearer <accountToken>' on every other call.",
    "2. Call startQrLogin, then send the user the connectPage link from the response: they open it and scan the QR with the Telegram app (Settings → Devices → Link Desktop Device).",
    "3. When the user says they scanned (or every ~10s while they wait), call getAccountStatus: waiting_scan = keep waiting; password_needed = ask for their Telegram cloud password and call submitPassword (never store or repeat it); authorized = done, tell them which Telegram account is connected; expired/error = call startQrLogin again for a fresh link.",
    "4. Only call disconnectAccount if the user explicitly asks, and confirm first - it logs out and deletes the stored account.",
  ].join("\\n");
  document.getElementById("gpt-instructions").value = gptInstructions;
  document.getElementById("copy-instructions").addEventListener("click", () => {
    navigator.clipboard.writeText(gptInstructions);
    document.getElementById("copy-instructions").textContent = "Copied ✓";
  });
  document.getElementById("create").addEventListener("click", async () => {
    const response = await fetch("/v1/accounts", { method: "POST" });
    if (!response.ok) { alert("Failed to create a connector — try again."); return; }
    const { accountToken } = await response.json();
    document.getElementById("mcp-url").textContent =
      location.origin + "/mcp/" + accountToken;
    document.getElementById("create").style.display = "none";
    document.getElementById("result").style.display = "block";
  });
</script>
</body>
</html>
`;

export const homePageHandler = publicHandler.parse({}).handle(async () => ({
  status: HTTPStatus.OK,
  headers: { "Content-Type": "text/html; charset=utf-8" },
  body: homePageHtml(),
}));
