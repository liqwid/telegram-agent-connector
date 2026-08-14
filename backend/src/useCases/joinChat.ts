import { logger } from "common/logging";

import type { AccountWithTokenHash } from "@/models/account";
import type { JoinChatResult } from "@/models/chatSearch";
import { joinChat as joinTelegramChat } from "@/services/telegramSearch";
import { withSessionClient } from "@/services/telegramSession";

/**
 * Join a chat by public @username or t.me invite link, so it becomes part of
 * the user's dialogs (and of global message search). Callers are expected to
 * confirm with the user before invoking this — joining is visible to the
 * chat's members and admins.
 */
export async function joinChat(
  account: AccountWithTokenHash,
  input: { chat: string },
): Promise<JoinChatResult> {
  logger.info("joinChat", { accountId: account.id, chat: input.chat });
  const result = await withSessionClient(account, (client) =>
    joinTelegramChat(client, input.chat),
  );
  logger.info("joinChat: done", {
    accountId: account.id,
    joined: result.joined,
    pendingApproval: result.pendingApproval,
  });
  return result;
}
