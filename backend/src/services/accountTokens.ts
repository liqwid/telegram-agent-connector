import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Bearer tokens for accounts. The token itself is returned once at account
 * creation and never stored — only its SHA-256 hash — so a database leak does
 * not leak live credentials.
 */

export function generateAccountId(): string {
  return randomBytes(6).toString("hex");
}

export function generateAccountToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAccountToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyAccountToken(
  presentedToken: string,
  storedTokenHash: string,
): boolean {
  const presentedHash = Buffer.from(hashAccountToken(presentedToken));
  const storedHash = Buffer.from(storedTokenHash);
  return (
    presentedHash.length === storedHash.length &&
    timingSafeEqual(presentedHash, storedHash)
  );
}
