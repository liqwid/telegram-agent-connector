import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "@/services/encryption";

describe("encryption", () => {
  it("round-trips plaintext and does not leak it", () => {
    const secret = "master-encryption-secret";
    const encrypted = encryptSecret("super-secret-private-key", secret);
    expect(encrypted).not.toContain("super-secret-private-key");
    expect(decryptSecret(encrypted, secret)).toBe("super-secret-private-key");
  });

  it("fails to decrypt with the wrong key", () => {
    const encrypted = encryptSecret("data", "key-one");
    expect(() => decryptSecret(encrypted, "key-two")).toThrow();
  });
});
