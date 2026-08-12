import { logger } from "common/logging";
import { parseItem, parseItemStrict } from "common/parseModels";

import { getDb } from "@/db";
import {
  type Account,
  accountSchema,
  type AccountWithTokenHash,
  accountWithTokenHashSchema,
  type AuthorizedSession,
  type NewAccount,
} from "@/models/account";

export async function insertAccount(input: NewAccount): Promise<Account> {
  logger.info("insertAccount: inserting", { accountId: input.id });
  const row = await getDb()
    .insertInto("accounts")
    .values({
      id: input.id,
      token_hash: input.tokenHash,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  logger.info("insertAccount: inserted", { accountId: row.id });
  return parseItemStrict(accountSchema, row);
}

/** Hash included — the authentication lookup. */
export async function findAccountWithTokenHashById(
  accountId: string,
): Promise<AccountWithTokenHash | null> {
  const row = await getDb()
    .selectFrom("accounts")
    .selectAll()
    .where("id", "=", accountId)
    .executeTakeFirst();
  return parseItem(accountWithTokenHashSchema, row);
}

export async function saveAccountSession(
  accountId: string,
  session: AuthorizedSession,
): Promise<void> {
  logger.info("saveAccountSession: saving", {
    accountId,
    tgUserId: session.tgUserId,
  });
  await getDb()
    .updateTable("accounts")
    .set({
      session_enc: session.sessionEnc,
      tg_user_id: session.tgUserId,
      tg_username: session.tgUsername,
      tg_first_name: session.tgFirstName,
      authorized_at: new Date(),
    })
    .where("id", "=", accountId)
    .execute();
  logger.info("saveAccountSession: saved", { accountId });
}

export async function deleteAccount(accountId: string): Promise<void> {
  logger.info("deleteAccount: deleting", { accountId });
  await getDb().deleteFrom("accounts").where("id", "=", accountId).execute();
  logger.info("deleteAccount: deleted", { accountId });
}
