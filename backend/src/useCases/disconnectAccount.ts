import { logger } from "common/logging";

import { env } from "@/env";
import type { AccountWithTokenHash } from "@/models/account";
import { deleteAccount } from "@/repositories/accountRepository";
import { decryptSecret } from "@/services/encryption";
import { dropQrLogin, logoutStoredSession } from "@/services/telegramLogin";

/**
 * Disconnect an account: cancel any in-flight login, best-effort log the
 * stored session out of Telegram (so the linked device disappears from the
 * user's device list), and delete the row.
 */
export async function disconnectAccount(
  account: AccountWithTokenHash,
): Promise<void> {
  logger.info("disconnectAccount: disconnecting", { accountId: account.id });
  await dropQrLogin(account.id);

  if (account.sessionEnc) {
    await logoutStoredSession(
      env.TELEGRAM_API_ID,
      env.TELEGRAM_API_HASH,
      decryptSecret(account.sessionEnc, env.ENCRYPTION_SECRET),
    );
  }

  await deleteAccount(account.id);
  logger.info("disconnectAccount: done", { accountId: account.id });
}
