import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

// Derive a fixed 32-byte AES key from an arbitrary-length secret.
const deriveKey = (secret: string): Buffer =>
  createHash("sha256").update(secret).digest();

/** AES-256-GCM encrypt; output is base64(iv ++ authTag ++ ciphertext). */
export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64",
  );
}

/** Reverse of {@link encryptSecret}; throws if the ciphertext was tampered. */
export function decryptSecret(encoded: string, secret: string): string {
  const data = Buffer.from(encoded, "base64");
  const iv = data.subarray(0, IV_BYTES);
  const authTag = data.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = data.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
