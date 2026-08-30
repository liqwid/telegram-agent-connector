import { env } from "@/env";
import { legalPage, mailto } from "@/legal/layout";

/**
 * The /contact page.
 *
 * One address, deliberately: the operator is one person, and publishing a
 * second channel we do not watch would be worse than publishing none. The
 * address comes from CONTACT_EMAIL so a self-hoster publishes their own — the
 * same value the ChatGPT plugin manifest reports as `contact_email`.
 */
export const contactHtml = (): string =>
  legalPage(
    "contact",
    "Contact",
    `<h1>Contact</h1>
<p>Write to <b>${mailto(env.CONTACT_EMAIL)}</b>.
It reaches the operator of <b>${env.PUBLIC_BASE_URL}</b> directly.</p>

<h2>What to write about</h2>
<ul>
  <li><b>Privacy and deletion requests</b> — see the
      <a href="/privacy">privacy policy</a> for what is held. You can also delete
      everything yourself at any time by asking your assistant to disconnect.</li>
  <li><b>Security reports</b> — please write before disclosing publicly, and say
      how you would like to be credited.</li>
  <li><b>Anything about the terms, the service, or the hosted instance.</b></li>
</ul>
<p>This is a small open-source project, so replies are best effort rather than a
support commitment.</p>

<h2>Bugs and feature requests</h2>
<p>These are better filed in the open, where other people can see and add to them:
<a href="https://github.com/liqwid/telegram-agent-connector/issues" rel="noopener">github.com/liqwid/telegram-agent-connector/issues</a>.</p>`,
  );
