import { describe, expect, it } from "vitest";

import { createPageToken, verifyPageToken } from "@/services/pageTokens";

describe("pageTokens", () => {
  it("round-trips a valid token", () => {
    const token = createPageToken("abc123", 60);
    expect(verifyPageToken(token, "abc123")).toBe(true);
  });

  it("rejects a token for another account", () => {
    const token = createPageToken("abc123", 60);
    expect(verifyPageToken(token, "other")).toBe(false);
  });

  it("rejects an expired token", () => {
    const token = createPageToken("abc123", -1);
    expect(verifyPageToken(token, "abc123")).toBe(false);
  });

  it("rejects a tampered token", () => {
    const token = createPageToken("abc123", 60);
    expect(verifyPageToken(`${token}x`, "abc123")).toBe(false);
    expect(verifyPageToken("pt.abc123.9999999999.forged", "abc123")).toBe(
      false,
    );
  });
});
