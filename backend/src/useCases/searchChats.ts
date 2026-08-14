import { logger } from "common/logging";

import type { AccountWithTokenHash } from "@/models/account";
import type { ChatSearchResult } from "@/models/chatSearch";
import { searchPublicChats } from "@/services/telegramSearch";
import { withSessionClient } from "@/services/telegramSession";

/**
 * Public-chat discovery by topic keyword variants (fanned out and merged).
 * Results include channels/groups the user has not joined
 * (`isJoined: false`) — those are the "suggest joining" candidates, and
 * public ones are directly searchable via `searchChatMessages` without
 * joining.
 */
export async function searchChats(
  account: AccountWithTokenHash,
  input: { queries: string[]; limit: number },
): Promise<ChatSearchResult> {
  logger.info("searchChats", {
    accountId: account.id,
    queries: input.queries,
    limit: input.limit,
  });
  const chats = await withSessionClient(account, (client) =>
    searchPublicChats(client, input),
  );
  logger.info("searchChats: done", {
    accountId: account.id,
    found: chats.length,
  });
  return { queries: input.queries, chats };
}
