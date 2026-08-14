import { CustomError } from "common";
import { logger } from "common/logging";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

import { env } from "@/env";
import type { AccountWithTokenHash } from "@/models/account";
import { NotConnectedError, TelegramRequestError } from "@/models/error";
import { decryptSecret } from "@/services/encryption";

/**
 * Short-lived Telegram clients over an account's stored session. Every call
 * connects a fresh client and always disconnects afterwards, so the process
 * stays stateless — mirroring the QR-login design, the only durable artifact
 * is the encrypted StringSession row.
 */

/** RPC codes meaning the stored session is dead, not the request. */
const DEAD_SESSION_CODES = [
  "AUTH_KEY_UNREGISTERED",
  "AUTH_KEY_INVALID",
  "SESSION_EXPIRED",
  "SESSION_REVOKED",
  "USER_DEACTIVATED",
];

/** The gramjs RPC error code, when `err` is an RPC error. */
export const rpcErrorCode = (err: unknown): string | null =>
  err !== null &&
  typeof err === "object" &&
  "errorMessage" in err &&
  typeof err.errorMessage === "string"
    ? err.errorMessage
    : null;

/** gramjs flood errors carry the wait time as `seconds`. */
const floodWaitSeconds = (err: unknown): number | null =>
  err !== null &&
  typeof err === "object" &&
  "seconds" in err &&
  typeof err.seconds === "number"
    ? err.seconds
    : null;

/** Translate gramjs failures into domain errors; domain errors pass through. */
const toDomainError = (err: unknown): unknown => {
  if (err instanceof CustomError) return err;
  const code = rpcErrorCode(err);
  if (code === null) return err;
  if (DEAD_SESSION_CODES.includes(code)) {
    return new NotConnectedError(
      "The stored Telegram session is no longer valid — reconnect with a new QR login",
    );
  }
  if (code.includes("FLOOD")) {
    const seconds = floodWaitSeconds(err);
    return new TelegramRequestError(
      seconds !== null
        ? `Telegram rate limit hit — retry in about ${seconds}s`
        : "Telegram rate limit hit — retry later",
    );
  }
  return new TelegramRequestError(`Telegram rejected the request: ${code}`);
};

/**
 * Run one unit of work against the account's stored session. Throws
 * `NotConnectedError` when the account has never completed a QR login (or the
 * session was revoked from another device).
 */
export async function withSessionClient<Result>(
  account: AccountWithTokenHash,
  work: (client: TelegramClient) => Promise<Result>,
): Promise<Result> {
  if (!account.sessionEnc) {
    throw new NotConnectedError(
      "This account has no Telegram session yet — connect with a QR login first",
    );
  }
  const session = new StringSession(
    decryptSecret(account.sessionEnc, env.ENCRYPTION_SECRET),
  );
  const client = new TelegramClient(
    session,
    env.TELEGRAM_API_ID,
    env.TELEGRAM_API_HASH,
    { connectionRetries: 2 },
  );
  try {
    await client.connect();
    return await work(client);
  } catch (err) {
    logger.warn("withSessionClient: telegram call failed", {
      accountId: account.id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw toDomainError(err);
  } finally {
    await safeDisconnect(client);
  }
}

async function safeDisconnect(client: TelegramClient): Promise<void> {
  try {
    await client.disconnect();
  } catch {
    // Already disconnected or never connected — nothing to clean up.
  }
}
