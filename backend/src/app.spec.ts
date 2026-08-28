import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "@/app";
import { env } from "@/env";

/**
 * Routes are registered, not merely written. A handler can typecheck, be
 * exported, be covered by unit tests and still never run because nobody wired
 * it into the app — the class of defect no unit test can see. So this suite
 * starts the real server and knocks on each door: anything other than 404
 * proves the route exists (auth rejects before any database access).
 */

const listening = (async () => {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = address !== null && typeof address !== "string"
    ? (address satisfies AddressInfo).port
    : 0;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
})();

afterAll(async () => {
  (await listening).server.close();
});

describe("createApp routing", () => {
  let baseUrl = "";

  beforeAll(async () => {
    baseUrl = (await listening).baseUrl;
  });

  it("answers 404 for a path nobody registered", async () => {
    const response = await fetch(`${baseUrl}/v1/accounts/abc/messages/nope`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat: "me", text: "hi" }),
    });
    expect(response.status).toBe(404);
  });

  it.each([
    ["/v1/accounts/abc/messages/send", "POST"],
    ["/v1/me/messages/send", "POST"],
    ["/v1/accounts/abc/chats/join", "POST"],
  ] as const)("registers %s", async (path, method) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat: "me", text: "hi" }),
    });
    expect(response.status).not.toBe(404);
  });
});

/**
 * The legal pages were one document on two routes until 2026-08-28. The defect
 * that would bring that back is not a crash and not a type error — it is
 * `app.get("/privacy", legalHandler)`, which typechecks, returns 200, and
 * quietly serves the wrong page. So the assertion is that the four routes
 * serve four DISTINCT documents, identified by their headings.
 */
const heading = (html: string): string | null =>
  html.match(/<h1>([^<]*)<\/h1>/)?.[1] ?? null;

describe("legal pages", () => {
  let baseUrl = "";

  beforeAll(async () => {
    baseUrl = (await listening).baseUrl;
  });

  it.each([
    ["/legal", "Legal"],
    ["/privacy", "Privacy Policy"],
    ["/terms", "Terms of Service"],
    ["/contact", "Contact"],
  ] as const)("serves %s as its own page", async (path, expected) => {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(heading(await response.text())).toBe(expected);
  });

  /**
   * Cloudflare rewrites any address it finds into a placeholder restored by
   * JavaScript, which on 2026-08-28 left the real address nowhere in the
   * served HTML. The `email_off` markers opt out of that, so the assertion is
   * that every page publishing the address wraps it — a page that stops
   * wrapping it goes back to publishing "[email protected]" to anyone who
   * fetches rather than renders.
   */
  it.each(["/privacy", "/terms", "/contact"] as const)(
    "publishes the contact address on %s in a form Cloudflare leaves alone",
    async (path) => {
      const body = await (await fetch(`${baseUrl}${path}`)).text();
      const wrapped = body.match(/<!--email_off-->([\s\S]*?)<!--\/email_off-->/);
      expect(wrapped?.[1]).toContain(`mailto:${env.CONTACT_EMAIL}`);
      expect(wrapped?.[1]).toContain(env.CONTACT_EMAIL);
    },
  );

  it("links only to pages that exist", async () => {
    const pages = ["/legal", "/privacy", "/terms", "/contact"];
    const bodies = await Promise.all(
      pages.map(async (path) => (await fetch(`${baseUrl}${path}`)).text()),
    );
    const targets = new Set(
      bodies.flatMap((body) =>
        Array.from(body.matchAll(/href="(\/[a-z][^"]*)"/g)).map(
          (match) => match[1] ?? "",
        ),
      ),
    );
    const statuses = await Promise.all(
      Array.from(targets).map(async (target) => ({
        target,
        status: (await fetch(`${baseUrl}${target}`)).status,
      })),
    );
    expect(statuses.filter(({ status }) => status === 404)).toEqual([]);
  });
});
