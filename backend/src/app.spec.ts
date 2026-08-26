import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "@/app";

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

describe("createApp routing", () => {
  let baseUrl = "";

  beforeAll(async () => {
    baseUrl = (await listening).baseUrl;
  });

  afterAll(async () => {
    (await listening).server.close();
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
