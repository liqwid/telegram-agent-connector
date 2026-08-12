import { NotFoundError } from "common";

import type { AccountWithTokenHash } from "@/models/account";
import { findAccountWithTokenHashById } from "@/repositories/accountRepository";

/** Re-read an account after a mutation elsewhere in the request. */
export async function refreshAccount(
  account: AccountWithTokenHash,
): Promise<AccountWithTokenHash> {
  const fresh = await findAccountWithTokenHashById(account.id);
  if (!fresh) {
    throw new NotFoundError("Account disappeared mid-request");
  }
  return fresh;
}
