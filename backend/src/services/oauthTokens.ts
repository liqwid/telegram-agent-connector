import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Random opaque credentials + PKCE verification for the OAuth server. */

export const generateClientId = (): string =>
  `cl_${randomBytes(9).toString("hex")}`;

export const generateClientSecret = (): string =>
  `cs_${randomBytes(32).toString("base64url")}`;

export const generateAuthorizationCode = (): string =>
  `ac_${randomBytes(32).toString("base64url")}`;

export const generateAccessToken = (): string =>
  `tat_${randomBytes(32).toString("base64url")}`;

export const generateRefreshToken = (): string =>
  `tar_${randomBytes(32).toString("base64url")}`;

export const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const secretMatches = (
  presented: string,
  storedHash: string,
): boolean => {
  const presentedHash = Buffer.from(sha256Hex(presented));
  const stored = Buffer.from(storedHash);
  return (
    presentedHash.length === stored.length &&
    timingSafeEqual(presentedHash, stored)
  );
};

/** PKCE S256: base64url(sha256(verifier)) must equal the stored challenge. */
export const pkceChallengeMatches = (
  verifier: string,
  challenge: string,
): boolean => {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const computedBuffer = Buffer.from(computed);
  const challengeBuffer = Buffer.from(challenge);
  return (
    computedBuffer.length === challengeBuffer.length &&
    timingSafeEqual(computedBuffer, challengeBuffer)
  );
};
