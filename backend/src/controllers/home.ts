import { HTTPStatus } from "common";

import { env } from "@/env";
import { publicHandler } from "@/utils/handler";

/**
 * Onboarding landing page: one click creates an account and shows the
 * personal connector URL to paste into Claude (claude.ai custom connector or
 * `claude mcp add --transport http`), plus the ChatGPT pointer. This is the
 * whole "install" — no local software.
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
  .warn { color: #8a5300; background: #fff6e0; border-radius: 8px; padding: .6rem .8rem; }
  #result { display: none; }
</style>
</head>
<body>
<h1>Telegram Agent Connector</h1>
<p>Link your Telegram account to Claude or ChatGPT. One click creates your personal
connector — no software to install.</p>
<button id="create">Create my connector</button>
<div id="result">
  <h2>Claude</h2>
  <p>Your personal connector URL:</p>
  <div class="url" id="mcp-url"></div>
  <p class="warn">⚠️ This URL is your key. Anyone who has it controls your Telegram
  link — treat it like a password. It is shown only here; copy it now.</p>
  <ul>
    <li><b>claude.ai / Claude Desktop</b>: Settings → Connectors → Add custom
        connector → paste the URL.</li>
    <li><b>Claude Code</b>: <code id="claude-code-cmd"></code></li>
  </ul>
  <p>Then ask Claude: <i>“connect my Telegram account”</i> — it shows a QR code to
  scan from the Telegram app (Settings → Devices → Link Desktop Device).</p>
  <h2>ChatGPT</h2>
  <p>Create a Custom GPT whose Action imports
  <code>${env.PUBLIC_BASE_URL}/openapi.json</code> — see the repository's
  <code>chatgpt/</code> guide.</p>
</div>
<script>
  document.getElementById("create").addEventListener("click", async () => {
    const response = await fetch("/v1/accounts", { method: "POST" });
    if (!response.ok) { alert("Failed to create a connector — try again."); return; }
    const { accountToken } = await response.json();
    const mcpUrl = location.origin + "/mcp/" + accountToken;
    document.getElementById("mcp-url").textContent = mcpUrl;
    document.getElementById("claude-code-cmd").textContent =
      "claude mcp add --transport http telegram " + mcpUrl;
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
