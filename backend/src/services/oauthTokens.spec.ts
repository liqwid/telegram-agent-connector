import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  generateAccessToken,
  pkceChallengeMatches,
  secretMatches,
  sha256Hex,
} from "@/services/oauthTokens";

describe("oauthTokens", () => {
  it("verifies a secret against its hash", () => {
    const token = generateAccessToken();
    expect(secretMatches(token, sha256Hex(token))).toBe(true);
    expect(secretMatches("other", sha256Hex(token))).toBe(false);
  });

  it("verifies a PKCE S256 challenge", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(pkceChallengeMatches(verifier, challenge)).toBe(true);
    expect(pkceChallengeMatches("wrong-verifier", challenge)).toBe(false);
  });
});
