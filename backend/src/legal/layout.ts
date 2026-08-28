import { env } from "@/env";

/**
 * Shared shell for the four public legal pages (/legal, /privacy, /terms,
 * /contact).
 *
 * They used to be one document served on two routes, which meant a store
 * listing asking for "your privacy policy" and a visitor asking "what are the
 * terms" were handed the same page and had to scroll for their half. Splitting
 * them costs a shared shell; this is it.
 *
 * The styling stays deliberately plain and self-contained: no fonts, no CDN,
 * no analytics — the landing page promises in writing that this origin makes
 * no third-party requests, and these pages are served from the same origin.
 */

type LegalPageName = "legal" | "privacy" | "terms" | "contact";

const NAV_ENTRIES: ReadonlyArray<{ name: LegalPageName; label: string }> = [
  { name: "legal", label: "Legal" },
  { name: "privacy", label: "Privacy" },
  { name: "terms", label: "Terms" },
  { name: "contact", label: "Contact" },
];

/** The current page is shown as plain text, so the nav says where you are. */
const navHtml = (current: LegalPageName): string =>
  NAV_ENTRIES.map(({ name, label }) =>
    name === current
      ? `<b>${label}</b>`
      : `<a href="/${name}">${label}</a>`,
  ).join(" · ");

export const legalPage = (
  current: LegalPageName,
  title: string,
  body: string,
): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Telegram Agent Connector</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 44rem; margin: 0 auto;
         padding: 2rem 1rem 4rem; line-height: 1.6; color: #1a1a2e; }
  h2 { margin-top: 1.6em; }
  nav { font-size: .9rem; padding-bottom: 1.6rem; color: #6f7873; }
  nav a { color: #1a1a2e; }
  footer { margin-top: 3rem; padding-top: 1.2rem; border-top: 1px solid #e3e3ea;
           font-size: .85rem; color: #6f7873; }
</style>
</head>
<body>
<nav>${navHtml(current)}</nav>
${body}
<footer>
  <a href="${env.PUBLIC_BASE_URL}/">Telegram Agent Connector</a> — an unofficial
  client built on the public Telegram API. Not made by, affiliated with, or
  endorsed by Telegram; Telegram is a registered trademark of Telegram
  Messenger Inc.
</footer>
</body>
</html>`;
