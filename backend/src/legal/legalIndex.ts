import { env } from "@/env";
import { legalPage } from "@/legal/layout";

/**
 * The /legal hub.
 *
 * It stays a page of its own rather than a redirect because the ChatGPT plugin
 * manifest publishes it as `legal_info_url` (see controllers/discovery.ts): a
 * store reviewer following that single link has to land somewhere that leads
 * to everything, not on one half of it.
 */
export const legalIndexHtml = (): string =>
  legalPage(
    "legal",
    "Legal",
    `<h1>Legal</h1>
<p>Telegram Agent Connector links your Telegram account to an AI assistant you
choose. The hosted instance at <b>${env.PUBLIC_BASE_URL}</b> is operated by the
address below; the software is open source under the
<a href="https://github.com/liqwid/telegram-agent-connector/blob/main/LICENSE" rel="noopener">MIT license</a>
and can be self-hosted, in which case you are your own operator.</p>

<h2>Documents</h2>
<ul>
  <li><a href="/privacy"><b>Privacy Policy</b></a> — what is stored, what is not,
      who it is shared with, and how to have it deleted.</li>
  <li><a href="/terms"><b>Terms of Service</b></a> — what the service does,
      acceptable use, and the absence of any warranty.</li>
  <li><a href="/contact"><b>Contact</b></a> — how to reach the operator.</li>
</ul>

<h2>Trademarks</h2>
<p>This is an unofficial client built on the public Telegram API. It is not made
by, affiliated with, or endorsed by Telegram. Telegram is a registered trademark
of Telegram Messenger Inc., and its name and marks belong to their owners.</p>`,
  );
