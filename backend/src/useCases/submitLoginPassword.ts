import { logger } from "common/logging";

import type { AccountWithTokenHash } from "@/models/account";
import { submitLoginPassword as submitToTelegram } from "@/services/telegramLogin";
import {
  type AccountStatus,
  getAccountStatus,
} from "@/useCases/getAccountStatus";
import { refreshAccount } from "@/useCases/refreshAccount";

/**
 * Complete a 2FA-protected QR login. Throws `InvalidPasswordError` when
 * Telegram rejects the password (the login stays alive for another attempt).
 */
export async function submitLoginPassword(
  account: AccountWithTokenHash,
  password: string,
): Promise<AccountStatus> {
  logger.info("submitLoginPassword: submitting", { accountId: account.id });
  await submitToTelegram(account.id, password);
  // Re-read: a successful check persisted the session just now.
  return getAccountStatus(await refreshAccount(account));
}
