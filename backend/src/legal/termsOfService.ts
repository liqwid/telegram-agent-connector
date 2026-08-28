import { env } from "@/env";
import { legalPage, mailto } from "@/legal/layout";

/**
 * The terms of service, as served on /terms.
 *
 * Written 2026-08-28 by expanding the single paragraph that used to sit at the
 * bottom of the privacy policy ("provided as-is under the MIT license, subject
 * to Telegram's ToS, abuse prohibited"). Every clause below is either that
 * paragraph unrolled or a statement about behaviour that already exists in the
 * deployed code — in particular the send tool, and the fact that the
 * confirmation before sending is an instruction to the assistant, not a check
 * the backend performs. A visitor is entitled to know which of the two it is.
 *
 * ⚠️ Not legal advice and not reviewed by a lawyer; see docs/landing.md.
 */
export const termsOfServiceHtml = (): string =>
  legalPage(
    "terms",
    "Terms of Service",
    `<h1>Terms of Service</h1>
<p>These terms cover the hosted instance at <b>${env.PUBLIC_BASE_URL}</b>. The
software itself is open source under the MIT license; running your own copy makes
you your own operator, and these terms do not apply to it.</p>

<h2>What the service does</h2>
<p>It links your Telegram account to an AI assistant that you choose, by way of a
QR login you perform yourself. Once linked, the assistant can search your chats,
read messages and threads, join a chat, and <b>send a message as you</b>. It acts
only when you ask it to, and it acts with your account's own permissions —
nothing more and nothing less than you could do in a Telegram client.</p>

<h2>You are responsible for what your account does</h2>
<p>Messages sent through this service are sent by <i>you</i>, from your Telegram
account. The assistant is instructed to show you the exact recipient and the exact
text and to wait for your go-ahead before sending, but that instruction is
followed by the assistant — <b>this service does not enforce it</b> and cannot
verify that you were asked. If you grant an assistant access to your account, you
accept what it sends on your behalf.</p>

<h2>Acceptable use</h2>
<p>Use of this service is subject to
<a href="https://telegram.org/tos" rel="noopener">Telegram's Terms of Service</a>
and its API terms. In addition, the following are prohibited here:</p>
<ul>
  <li>unsolicited bulk messaging, spam, or automated outreach to people who did
      not ask to hear from you;</li>
  <li>mass collection or redistribution of other people's messages or contact
      details;</li>
  <li>impersonating another person, or concealing that a message was composed
      with an assistant when asked;</li>
  <li>anything unlawful in your jurisdiction, and anything intended to harass,
      threaten or deceive.</li>
</ul>
<p>Telegram enforces its own limits independently of us. Hitting them can get your
Telegram account restricted or banned, and that outcome is between you and
Telegram.</p>

<h2>Availability and termination</h2>
<p>The hosted instance is offered as a convenience, without any uptime commitment,
and may change or stop at any time. We may disconnect an account that breaches
these terms or that endangers the service, and we may do so without notice where
the breach is ongoing. You can disconnect at any time — ask your assistant to log
out, or terminate the session from Telegram → Settings → Devices; either deletes
the stored session.</p>

<h2>No warranty, no liability</h2>
<p>The service and the software are provided <b>as is</b>, without warranty of any
kind, express or implied, as stated in the MIT license. To the fullest extent
permitted by law, the operator is not liable for any damages arising from use of
the service, including lost or wrongly sent messages, a restricted Telegram
account, or unavailability.</p>

<h2>Changes</h2>
<p>These terms may change as the connector changes. The current version is always
the one on this page; continued use after a change means you accept it.</p>

<h2>Contact</h2>
<p>Questions about these terms:
${mailto(env.CONTACT_EMAIL)}, or see the
<a href="/contact">contact page</a>.</p>`,
  );
