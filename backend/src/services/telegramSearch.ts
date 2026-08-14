import { Api, type TelegramClient } from "telegram";

import {
  type ChatSummary,
  type JoinChatResult,
  MAX_HIT_TEXT_LENGTH,
  type MessageChatRef,
  type MessageHit,
  type VariantStat,
} from "@/models/chatSearch";
import { ChatNotFoundError } from "@/models/error";
import { rpcErrorCode } from "@/services/telegramSession";

/**
 * Search operations over a connected Telegram client:
 *
 * - public-chat discovery (`contacts.Search`) — includes channels/groups the
 *   user has NOT joined, flagged `isJoined: false` so callers can suggest
 *   joining them;
 * - message search — global across the user's joined dialogs
 *   (`messages.SearchGlobal`) or inside one chat (`messages.Search`; public
 *   channels are searchable this way without joining), plus a browse mode
 *   (`messages.GetHistory`) that reads a chat's recent messages with no query;
 * - joining chats by public username or invite link.
 *
 * Telegram search is literal word matching, so every search fans out over a
 * list of query variants (synonyms, other languages) and merges the results —
 * that fan-out, driven by an LLM generating the variants, is what makes this
 * behave like web-style research. Mapping helpers are pure and exported for
 * tests.
 */

/** First occurrence wins — earlier query variants take precedence. */
const dedupeBy = <Item>(
  items: Item[],
  keyOf: (item: Item) => string,
): Item[] => [
  ...items
    .reduce(
      (byKey, item) =>
        byKey.has(keyOf(item)) ? byKey : byKey.set(keyOf(item), item),
      new Map<string, Item>(),
    )
    .values(),
];

export type ChatRef =
  | { kind: "public"; username: string }
  | { kind: "invite"; hash: string };

/**
 * Normalize the chat references users paste: `@name`, `name`,
 * `https://t.me/name[/123]`, `t.me/+hash`, `t.me/joinchat/hash`.
 */
export function parseChatRef(input: string): ChatRef {
  const bare = input
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?(t|telegram)\.me\//i, "");
  const inviteHash = bare.match(/^(?:\+|joinchat\/)([A-Za-z0-9_-]+)/)?.[1];
  if (inviteHash) return { kind: "invite", hash: inviteHash };
  return {
    kind: "public",
    username: bare.replace(/^@/, "").replace(/[/?#].*$/, ""),
  };
}

const peerKey = (peer: Api.TypePeer): string =>
  peer instanceof Api.PeerChannel
    ? peer.channelId.toString()
    : peer instanceof Api.PeerChat
      ? peer.chatId.toString()
      : peer.userId.toString();

/** Map a raw Telegram chat to the API shape; null for inaccessible chats. */
export const toChatSummary = (
  chat: Api.TypeChat,
  joinedPeerIds: ReadonlySet<string>,
): ChatSummary | null => {
  if (chat instanceof Api.Channel) {
    const username = chat.username ?? null;
    return {
      id: chat.id.toString(),
      title: chat.title,
      username,
      kind: chat.broadcast ? "channel" : "group",
      memberCount: chat.participantsCount ?? null,
      // `left` is false on chats the user participates in; global search
      // results additionally show up in `myResults` when joined.
      isJoined: chat.left === false || joinedPeerIds.has(chat.id.toString()),
      link: username ? `https://t.me/${username}` : null,
    };
  }
  if (chat instanceof Api.Chat) {
    return {
      id: chat.id.toString(),
      title: chat.title,
      username: null,
      kind: "group",
      memberCount: chat.participantsCount ?? null,
      isJoined: !chat.left,
      link: null,
    };
  }
  return null;
};

/** Joined chats first, then by audience size — the order agents should read. */
export const sortChatSummaries = (chats: ChatSummary[]): ChatSummary[] =>
  [...chats].sort((first, second) =>
    first.isJoined !== second.isJoined
      ? Number(second.isJoined) - Number(first.isJoined)
      : (second.memberCount ?? 0) - (first.memberCount ?? 0),
  );

/**
 * Find public channels/groups matching any of the query variants. Telegram's
 * global search matches titles/usernames literally, so short keyword variants
 * ("Tbilisi second hand", "барахолка Тбилиси") beat full sentences.
 */
export async function searchPublicChats(
  client: TelegramClient,
  input: { queries: string[]; limit: number },
): Promise<ChatSummary[]> {
  const perQuery = await Promise.all(
    input.queries.map(async (query) => {
      const found = await client.invoke(
        new Api.contacts.Search({ q: query, limit: input.limit }),
      );
      const joinedPeerIds = new Set(found.myResults.map(peerKey));
      return found.chats.flatMap((chat) => {
        const summary = toChatSummary(chat, joinedPeerIds);
        return summary ? [summary] : [];
      });
    }),
  );
  return sortChatSummaries(dedupeBy(perQuery.flat(), (chat) => chat.id));
}

type MessagesPage = {
  messages: Api.TypeMessage[];
  chats: Api.TypeChat[];
  users: Api.TypeUser[];
};

const toMessagesPage = (result: Api.messages.TypeMessages): MessagesPage =>
  result instanceof Api.messages.MessagesNotModified
    ? { messages: [], chats: [], users: [] }
    : { messages: result.messages, chats: result.chats, users: result.users };

const userDisplayName = (user: Api.TypeUser): string | null => {
  if (!(user instanceof Api.User)) return null;
  const fullName = [user.firstName, user.lastName]
    .flatMap((part) => (part ? [part] : []))
    .join(" ");
  return fullName || user.username || null;
};

const toMessageChatRef = (
  peer: Api.TypePeer,
  chatsById: ReadonlyMap<string, Api.TypeChat>,
  usersById: ReadonlyMap<string, Api.TypeUser>,
): MessageChatRef | null => {
  if (peer instanceof Api.PeerUser) {
    const user = usersById.get(peer.userId.toString());
    return user
      ? {
          id: user.id.toString(),
          title: userDisplayName(user) ?? "Private chat",
          username: user instanceof Api.User ? (user.username ?? null) : null,
        }
      : null;
  }
  const chat = chatsById.get(peerKey(peer));
  return chat
    ? {
        id: chat.id.toString(),
        title: "title" in chat ? chat.title : "Unavailable chat",
        username: chat instanceof Api.Channel ? (chat.username ?? null) : null,
      }
    : null;
};

const truncateText = (text: string): string =>
  text.length <= MAX_HIT_TEXT_LENGTH
    ? text
    : `${text.slice(0, MAX_HIT_TEXT_LENGTH)}…`;

const toMessageHit = (
  message: Api.Message,
  chatsById: ReadonlyMap<string, Api.TypeChat>,
  usersById: ReadonlyMap<string, Api.TypeUser>,
  matchedQuery: string | null,
): MessageHit => {
  const chat = toMessageChatRef(message.peerId, chatsById, usersById);
  const sender =
    message.fromId instanceof Api.PeerUser
      ? (usersById.get(message.fromId.userId.toString()) ?? null)
      : null;
  return {
    chat,
    messageId: message.id,
    sentAt: new Date(message.date * 1000),
    senderName: sender ? userDisplayName(sender) : null,
    text: truncateText(message.message),
    replyToMsgId:
      message.replyTo instanceof Api.MessageReplyHeader
        ? (message.replyTo.replyToMsgId ?? null)
        : null,
    matchedQuery,
    link: chat?.username
      ? `https://t.me/${chat.username}/${message.id}`
      : null,
  };
};

/** Flatten a Telegram messages result into hits (service messages skipped). */
export const toMessageHits = (
  result: Api.messages.TypeMessages,
  matchedQuery: string | null,
): MessageHit[] => {
  const page = toMessagesPage(result);
  const chatsById = new Map(
    page.chats.map((chat): [string, Api.TypeChat] => [
      chat.id.toString(),
      chat,
    ]),
  );
  const usersById = new Map(
    page.users.map((user): [string, Api.TypeUser] => [
      user.id.toString(),
      user,
    ]),
  );
  return page.messages.flatMap((message) =>
    message instanceof Api.Message
      ? [toMessageHit(message, chatsById, usersById, matchedQuery)]
      : [],
  );
};

const messageHitKey = (hit: MessageHit): string =>
  `${hit.chat?.id ?? "?"}:${hit.messageId}`;

/** Telegram returns at most this many messages per RPC. */
const TELEGRAM_PAGE_SIZE = 100;

const rawMessageIds = (page: Api.messages.TypeMessages): number[] =>
  page instanceof Api.messages.MessagesNotModified
    ? []
    : page.messages.map((message) => message.id);

/** Telegram's total match count for a search, when it reports one. */
const pageTotalCount = (page: Api.messages.TypeMessages): number | null =>
  page instanceof Api.messages.MessagesSlice ||
  page instanceof Api.messages.ChannelMessages
    ? page.count
    : page instanceof Api.messages.Messages
      ? page.messages.length
      : null;

/**
 * Page through a chat's history/search results (Telegram caps each RPC at
 * 100 messages) until `remaining` messages were fetched or the results dry
 * up. Sequential on purpose — bursts of parallel pages invite FLOOD_WAITs;
 * gramjs auto-sleeps through the short ones.
 */
const fetchDeep = async (
  fetchPage: (
    offsetId: number,
    pageLimit: number,
  ) => Promise<Api.messages.TypeMessages>,
  remaining: number,
  offsetId: number,
): Promise<Api.messages.TypeMessages[]> => {
  const pageLimit = Math.min(remaining, TELEGRAM_PAGE_SIZE);
  const page = await fetchPage(offsetId, pageLimit);
  const ids = rawMessageIds(page);
  const lowestId = ids.length > 0 ? Math.min(...ids) : null;
  const exhausted =
    lowestId === null || lowestId <= 1 || ids.length < pageLimit;
  return exhausted || remaining <= ids.length
    ? [page]
    : [page, ...(await fetchDeep(fetchPage, remaining - ids.length, lowestId))];
};

/** Newest first — merged multi-variant results read like a feed. */
export const sortMessageHits = (hits: MessageHit[]): MessageHit[] =>
  [...hits].sort(
    (first, second) =>
      (second.sentAt?.getTime() ?? 0) - (first.sentAt?.getTime() ?? 0),
  );

/**
 * Search messages across everything the user's account can see (joined
 * dialogs), fanning out over the query variants and merging newest-first.
 * `limit` applies per variant, capped at one Telegram page — deep paging is
 * per-chat territory (SearchGlobal cursors are composite and Telegram
 * reports no totals for it).
 */
export async function searchMessagesGlobal(
  client: TelegramClient,
  input: { queries: string[]; limit: number },
): Promise<MessageHit[]> {
  const perQuery = await Promise.all(
    input.queries.map(async (query) => {
      const result = await client.invoke(
        new Api.messages.SearchGlobal({
          q: query,
          filter: new Api.InputMessagesFilterEmpty(),
          minDate: 0,
          maxDate: 0,
          offsetRate: 0,
          offsetPeer: new Api.InputPeerEmpty(),
          offsetId: 0,
          limit: Math.min(input.limit, TELEGRAM_PAGE_SIZE),
        }),
      );
      return toMessageHits(result, query);
    }),
  );
  return sortMessageHits(dedupeBy(perQuery.flat(), messageHitKey));
}

const resolvePublicChat = async (
  client: TelegramClient,
  username: string,
): Promise<Api.Channel | Api.Chat> => {
  const entity = await client.getEntity(username).catch(() => null);
  if (entity instanceof Api.Channel || entity instanceof Api.Chat) {
    return entity;
  }
  throw new ChatNotFoundError(
    entity === null
      ? `No Telegram chat found for "${username}" — check the @username or t.me link`
      : `"${username}" is a user, not a chat`,
  );
};

type VariantFetch = {
  matchedQuery: string | null;
  pages: Api.messages.TypeMessages[];
};

const resolveSearchableChat = async (
  client: TelegramClient,
  chatRef: string,
): Promise<{ entity: Api.Channel | Api.Chat; summary: ChatSummary }> => {
  const ref = parseChatRef(chatRef);
  if (ref.kind === "invite") {
    throw new ChatNotFoundError(
      "Private invite links cannot be searched directly — join the chat first, then search it",
    );
  }
  const entity = await resolvePublicChat(client, ref.username);
  const summary = toChatSummary(entity, new Set());
  if (!summary) {
    throw new ChatNotFoundError(`"${ref.username}" is not an accessible chat`);
  }
  return { entity, summary };
};

/** The searched chat is known — fill it in for hits Telegram did not resolve. */
const withChatFallback = (
  hits: MessageHit[],
  summary: ChatSummary,
): MessageHit[] => {
  const fallbackRef: MessageChatRef = {
    id: summary.id,
    title: summary.title,
    username: summary.username,
  };
  return hits.map((hit) =>
    hit.chat
      ? hit
      : {
          ...hit,
          chat: fallbackRef,
          link: summary.username
            ? `https://t.me/${summary.username}/${hit.messageId}`
            : null,
        },
  );
};

/**
 * Search inside one chat, referenced by @username or t.me link. Works for
 * public channels/groups the user has not joined — the research path for
 * chats surfaced by `searchPublicChats`. With no queries it browses the
 * chat's recent messages instead (`messages.GetHistory`) — useful for
 * learning a community's local vocabulary before searching it.
 *
 * Built for bulk research: pages internally (up to `limit` messages per
 * variant), reports Telegram's total match count per variant, and returns a
 * `nextOffsetId` cursor so callers can walk thousands of messages across
 * successive calls.
 */
export async function searchMessagesInChat(
  client: TelegramClient,
  input: { chat: string; queries: string[]; limit: number; offsetId: number },
): Promise<{
  chat: ChatSummary;
  variantStats: VariantStat[];
  nextOffsetId: number | null;
  messages: MessageHit[];
}> {
  const { entity, summary } = await resolveSearchableChat(client, input.chat);
  const variantFetches: VariantFetch[] =
    input.queries.length === 0
      ? [
          {
            matchedQuery: null,
            pages: await fetchDeep(
              (offsetId, pageLimit) =>
                client.invoke(
                  new Api.messages.GetHistory({
                    peer: entity,
                    offsetId,
                    offsetDate: 0,
                    addOffset: 0,
                    limit: pageLimit,
                    maxId: 0,
                    minId: 0,
                  }),
                ),
              input.limit,
              input.offsetId,
            ),
          },
        ]
      : await Promise.all(
          input.queries.map(async (query) => ({
            matchedQuery: query,
            pages: await fetchDeep(
              (offsetId, pageLimit) =>
                client.invoke(
                  new Api.messages.Search({
                    peer: entity,
                    q: query,
                    filter: new Api.InputMessagesFilterEmpty(),
                    minDate: 0,
                    maxDate: 0,
                    offsetId,
                    addOffset: 0,
                    limit: pageLimit,
                    maxId: 0,
                    minId: 0,
                  }),
                ),
              input.limit,
              input.offsetId,
            ),
          })),
        );
  const variantStats = variantFetches.map(
    ({ matchedQuery, pages }): VariantStat => {
      const firstPage = pages.at(0);
      return {
        query: matchedQuery,
        totalCount: firstPage ? pageTotalCount(firstPage) : null,
        fetched: pages.flatMap(rawMessageIds).length,
      };
    },
  );
  const messages = withChatFallback(
    variantFetches.flatMap(({ matchedQuery, pages }) =>
      pages.flatMap((page) => toMessageHits(page, matchedQuery)),
    ),
    summary,
  );
  // More history remains when any variant filled its budget; continuing
  // below the oldest fetched id covers every variant, at worst re-reading a
  // few messages (the merge dedupes).
  const fetchedIds = variantFetches.flatMap(({ pages }) =>
    pages.flatMap(rawMessageIds),
  );
  const hasMore = variantStats.some((stat) => stat.fetched >= input.limit);
  const nextOffsetId =
    hasMore && fetchedIds.length > 0 ? Math.min(...fetchedIds) : null;
  return {
    chat: summary,
    variantStats,
    nextOffsetId,
    messages: sortMessageHits(dedupeBy(messages, messageHitKey)),
  };
}

/**
 * Fetch specific messages by id — the thread-context companion to search:
 * hits carry `replyToMsgId`, and recommendations usually answer a question
 * asked a few messages earlier.
 */
export async function fetchChatMessages(
  client: TelegramClient,
  input: { chat: string; ids: number[] },
): Promise<{ chat: ChatSummary; messages: MessageHit[] }> {
  const { entity, summary } = await resolveSearchableChat(client, input.chat);
  const inputIds = input.ids.map((id) => new Api.InputMessageID({ id }));
  const result =
    entity instanceof Api.Channel
      ? await client.invoke(
          new Api.channels.GetMessages({ channel: entity, id: inputIds }),
        )
      : await client.invoke(new Api.messages.GetMessages({ id: inputIds }));
  return {
    chat: summary,
    messages: sortMessageHits(
      withChatFallback(toMessageHits(result, null), summary),
    ),
  };
}

const firstChatSummary = (updates: Api.TypeUpdates): ChatSummary | null =>
  updates instanceof Api.Updates || updates instanceof Api.UpdatesCombined
    ? (updates.chats.flatMap((chat) => {
        const summary = toChatSummary(chat, new Set());
        return summary ? [summary] : [];
      })[0] ?? null)
    : null;

/**
 * Join a chat by public username or invite link. Approval-gated chats file a
 * join request instead of joining immediately — reported as pendingApproval.
 */
export async function joinChat(
  client: TelegramClient,
  chatRef: string,
): Promise<JoinChatResult> {
  const ref = parseChatRef(chatRef);
  try {
    const updates =
      ref.kind === "invite"
        ? await client.invoke(
            new Api.messages.ImportChatInvite({ hash: ref.hash }),
          )
        : await client.invoke(
            new Api.channels.JoinChannel({
              channel: await resolvePublicChat(client, ref.username),
            }),
          );
    const chat = firstChatSummary(updates);
    return {
      joined: true,
      pendingApproval: false,
      chat: chat ? { ...chat, isJoined: true } : null,
    };
  } catch (err) {
    const code = rpcErrorCode(err);
    if (code === "INVITE_REQUEST_SENT") {
      return { joined: false, pendingApproval: true, chat: null };
    }
    if (code === "USER_ALREADY_PARTICIPANT") {
      return { joined: true, pendingApproval: false, chat: null };
    }
    if (code === "INVITE_HASH_EXPIRED" || code === "INVITE_HASH_INVALID") {
      throw new ChatNotFoundError("This invite link is expired or invalid");
    }
    throw err;
  }
}
