import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/env";

/**
 * Short-lived signed tokens for QR-page links (`?token=` on /connect and
 * /qr.png). OAuth-created accounts never expose a raw bearer token, so links
 * carry these instead: HMAC-signed, account-scoped, expiring with the login
 * window — leaking one in a browser history is worth minutes, not forever.
 */

const signingKey = (): Buffer =>
  createHash("sha256").update(`page-token:${env.ENCRYPTION_SECRET}`).digest();

const signature = (accountId: string, expiresAtSeconds: number): string =>
  createHmac("sha256", signingKey())
    .update(`${accountId}.${expiresAtSeconds}`)
    .digest("base64url");

export function createPageToken(accountId: string, ttlSeconds: number): string {
  const expiresAtSeconds = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `pt.${accountId}.${expiresAtSeconds}.${signature(accountId, expiresAtSeconds)}`;
}

/** True when the token is intact, unexpired, and scoped to this account. */
export function verifyPageToken(token: string, accountId: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "pt") return false;
  const [, tokenAccountId, expiresRaw, presentedSignature] = parts;
  if (tokenAccountId !== accountId || !expiresRaw || !presentedSignature) {
    return false;
  }
  const expiresAtSeconds = Number(expiresRaw);
  if (!Number.isInteger(expiresAtSeconds)) return false;
  if (expiresAtSeconds * 1000 < Date.now()) return false;
  const expected = Buffer.from(signature(accountId, expiresAtSeconds));
  const presented = Buffer.from(presentedSignature);
  return (
    expected.length === presented.length && timingSafeEqual(expected, presented)
  );
}
