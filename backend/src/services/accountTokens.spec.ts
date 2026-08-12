import { describe, expect, it } from "vitest";

import {
  generateAccountToken,
  hashAccountToken,
  verifyAccountToken,
} from "@/services/accountTokens";

describe("accountTokens", () => {
  it("verifies a token against its own hash", () => {
    const token = generateAccountToken();
    expect(verifyAccountToken(token, hashAccountToken(token))).toBe(true);
  });

  it("rejects a different token", () => {
    const token = generateAccountToken();
    const other = generateAccountToken();
    expect(verifyAccountToken(other, hashAccountToken(token))).toBe(false);
  });

  it("rejects garbage stored hashes without throwing", () => {
    expect(verifyAccountToken(generateAccountToken(), "not-a-hash")).toBe(
      false,
    );
  });
});
