import { logger } from "common/logging";

import { insertAccount } from "@/repositories/accountRepository";
import {
  generateAccountId,
  generateAccountToken,
  hashAccountToken,
} from "@/services/accountTokens";

export type CreatedAccount = {
  accountId: string;
  accountToken: string;
};

/**
 * Register a new account slot and mint the bearer token that scopes every
 * subsequent call to it. The token is returned exactly once; only its hash is
 * stored. The Telegram application credentials are deployment configuration —
 * nothing user-supplied is needed here.
 */
export async function createAccount(): Promise<CreatedAccount> {
  const accountId = generateAccountId();
  const accountToken = generateAccountToken();
  logger.info("createAccount: creating", { accountId });

  await insertAccount({
    id: accountId,
    tokenHash: hashAccountToken(accountToken),
  });

  logger.info("createAccount: created", { accountId });
  return { accountId, accountToken };
}
