import { describe, expect, it } from "vitest";

import {
  connectPageHtml,
  isPasswordSafeChannel,
} from "@/controllers/connectPage";

/**
 * The page takes a Telegram cloud password, so the property under test is not
 * "does it look right" but "is the field withheld on a channel that would leak
 * it". Both halves are checked: the decision, and the page actually built from
 * it — a correct predicate wired to nothing would pass the first alone.
 */

describe("isPasswordSafeChannel", () => {
  it("serves the form behind a proxy reporting the visitor on https", () => {
    expect(isPasswordSafeChannel("https", "tgagent.grownow.tech")).toBe(true);
  });

  it("withholds it from a plain-http visitor", () => {
    expect(isPasswordSafeChannel("http", "tgagent.grownow.tech")).toBe(false);
  });

  it("withholds it when no proxy reported a scheme at all", () => {
    expect(isPasswordSafeChannel(null, "tgagent.grownow.tech")).toBe(false);
  });

  it.each(["localhost", "127.0.0.1", "::1"])(
    "trusts %s, where nothing leaves the machine",
    (hostname) => {
      expect(isPasswordSafeChannel(null, hostname)).toBe(true);
    },
  );

  it("does not trust a hostname that merely CONTAINS localhost", () => {
    expect(isPasswordSafeChannel(null, "localhost.evil.example")).toBe(false);
    expect(isPasswordSafeChannel(null, "notlocalhost")).toBe(false);
  });
});

describe("connectPageHtml", () => {
  it("arms the form when the channel is safe", () => {
    expect(connectPageHtml("acc-1", true)).toContain(
      "const passwordForm = true;",
    );
  });

  it("disarms it when the channel is not — the flag, not just the markup", () => {
    const page = connectPageHtml("acc-1", false);
    expect(page).toContain("const passwordForm = false;");
    // The unsafe page still tells the user where to go instead of dead-ending.
    expect(page).toContain("enter the");
    expect(page).toContain("password back in the chat");
  });

  it("sends the password over POST with the token in a header, never the URL", () => {
    const page = connectPageHtml("acc-1", true);
    expect(page).toContain('base + "/password"');
    expect(page).toContain('"Authorization": "Bearer " + token');
    // A password or token in a query string lands in every access log.
    expect(page).not.toMatch(/\/password\?[^"']*token/);
    expect(page).not.toMatch(/password=/);
  });

  it("keeps polling after the form appears, so success is noticed", () => {
    // The old page called clearInterval on password_needed and went blind.
    const page = connectPageHtml("acc-1", true);
    const askBody = page.slice(
      page.indexOf("const askForPassword"),
      page.indexOf("form.addEventListener"),
    );
    expect(askBody).toContain("clearInterval"); // only on the unsafe branch
    expect(
      askBody.slice(
        askBody.indexOf(
          'statusText.textContent = "🔐 Scanned. One more step:"',
        ),
      ),
    ).not.toContain("clearInterval");
  });
});
