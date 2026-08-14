import { logger } from "common/logging";

import type { AccountWithTokenHash } from "@/models/account";
import type { MessageFetchResult } from "@/models/chatSearch";
import { InvalidRequestError } from "@/models/error";
import { fetchChatMessages } from "@/services/telegramSearch";
import { withSessionClient } from "@/services/telegramSession";

export const MAX_FETCH_IDS = 100;

/**
 * Fetch specific messages from a chat by id — used to pull reply-thread
 * context around search hits (`replyToMsgId`) or to read a message the
 * truncated digest cut short. Works for public chats without joining.
 */
export async function fetchMessages(
  account: AccountWithTokenHash,
  input: { chat: string; ids: number[] },
): Promise<MessageFetchResult> {
  logger.info("fetchMessages", {
    accountId: account.id,
    chat: input.chat,
    ids: input.ids.length,
  });
  if (input.ids.length === 0 || input.ids.length > MAX_FETCH_IDS) {
    throw new InvalidRequestError(
      `Provide between 1 and ${MAX_FETCH_IDS} message ids`,
    );
  }
  return withSessionClient(account, (client) =>
    fetchChatMessages(client, input),
  );
}
