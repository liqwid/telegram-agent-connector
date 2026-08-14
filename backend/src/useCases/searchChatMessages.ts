import { logger } from "common/logging";

import type { AccountWithTokenHash } from "@/models/account";
import type { MessageSearchResult } from "@/models/chatSearch";
import { InvalidRequestError } from "@/models/error";
import {
  searchMessagesGlobal,
  searchMessagesInChat,
} from "@/services/telegramSearch";
import { withSessionClient } from "@/services/telegramSession";

/**
 * Message research: fans out over the query variants and merges newest-first.
 * Global across the user's joined dialogs when no chat is given, otherwise
 * inside the referenced chat — public channels/groups are searchable this way
 * even before joining. An empty query list with a chat browses that chat's
 * recent messages instead. Chat-scoped calls page internally and return a
 * `nextOffsetId` cursor plus per-variant totals, so callers can walk
 * thousands of messages across successive calls.
 */
export async function searchChatMessages(
  account: AccountWithTokenHash,
  input: {
    queries: string[];
    chat: string | null;
    limit: number;
    offsetId: number | null;
  },
): Promise<MessageSearchResult> {
  logger.info("searchChatMessages", {
    accountId: account.id,
    queries: input.queries,
    chat: input.chat,
    limit: input.limit,
    offsetId: input.offsetId,
  });
  if (input.queries.length === 0 && input.chat === null) {
    throw new InvalidRequestError(
      "Provide at least one query, or a chat to browse its recent messages",
    );
  }
  if (input.offsetId !== null && input.chat === null) {
    throw new InvalidRequestError(
      "offsetId pagination only works inside one chat — pass the chat parameter",
    );
  }
  return withSessionClient(
    account,
    async (client): Promise<MessageSearchResult> => {
      if (input.chat !== null) {
        const inChat = await searchMessagesInChat(client, {
          chat: input.chat,
          queries: input.queries,
          limit: input.limit,
          offsetId: input.offsetId ?? 0,
        });
        return {
          queries: input.queries,
          scope: "chat",
          chat: inChat.chat,
          variantStats: inChat.variantStats,
          nextOffsetId: inChat.nextOffsetId,
          messages: inChat.messages,
        };
      }
      const messages = await searchMessagesGlobal(client, {
        queries: input.queries,
        limit: input.limit,
      });
      return {
        queries: input.queries,
        scope: "global",
        chat: null,
        variantStats: null,
        nextOffsetId: null,
        messages,
      };
    },
  );
}
