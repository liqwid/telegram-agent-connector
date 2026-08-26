import { z } from "zod";

/**
 * Chat discovery & research shapes. Results are produced from typed gramjs
 * responses (not parsed from raw JSON), so they are plain types rather than
 * Zod schemas — the runtime boundary is Telegram's TL layer, already typed.
 */

export const MAX_QUERY_VARIANTS = 5;

/** Message texts are cut here so bulk research digests stay compact. */
export const MAX_HIT_TEXT_LENGTH = 1000;

/**
 * One query string, a repeated query param, or comma-separated variants
 * ("macbook, макбук") — normalized to a trimmed list capped at
 * MAX_QUERY_VARIANTS. Telegram search is literal word matching (no semantic
 * search, weak morphology), so several short variants across synonyms and
 * languages is how callers get web-search-like recall.
 */
export const queryListSchema = z
  .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
  .transform((value) =>
    (typeof value === "string" ? [value] : value)
      .flatMap((part) => part.split(","))
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .slice(0, MAX_QUERY_VARIANTS),
  )
  .refine((queries) => queries.length > 0, {
    message: "At least one non-empty query is required",
  });

export type ChatKind = "channel" | "group" | "private";

/** A channel, group, or private dialog with one person. */
export type ChatSummary = {
  id: string;
  title: string;
  username: string | null;
  kind: ChatKind;
  memberCount: number | null;
  /** False means a public chat the user has not joined — a join candidate. */
  isJoined: boolean;
  /** Public t.me link, when the chat has a username. */
  link: string | null;
};

export type ChatSearchResult = {
  queries: string[];
  chats: ChatSummary[];
};

/** Where a found message lives — a channel, group, or private dialog. */
export type MessageChatRef = {
  id: string;
  title: string;
  username: string | null;
};

export type MessageHit = {
  chat: MessageChatRef | null;
  messageId: number;
  sentAt: Date | null;
  senderName: string | null;
  /** Truncated for bulk research digests (see MAX_HIT_TEXT_LENGTH). */
  text: string;
  /** Id of the message this one replies to — fetch it for thread context. */
  replyToMsgId: number | null;
  /** Which query variant found this hit; null in browse/fetch modes. */
  matchedQuery: string | null;
  /** Public t.me deep link to the message, when the chat has a username. */
  link: string | null;
};

export type MessageSearchScope = "global" | "chat";

/** Coverage stats for one query variant (null query = browse mode). */
export type VariantStat = {
  query: string | null;
  /** Total matches Telegram reports in the chat — not just what was fetched. */
  totalCount: number | null;
  fetched: number;
};

export type MessageSearchResult = {
  /** Empty when browsing a chat's recent messages without a query. */
  queries: string[];
  scope: MessageSearchScope;
  /** The searched chat when scope is "chat"; null for global searches. */
  chat: ChatSummary | null;
  /** Per-variant coverage; null for global scope (Telegram reports none). */
  variantStats: VariantStat[] | null;
  /**
   * Cursor for paging deeper into history: pass as offsetId on the next call
   * to continue below the oldest message fetched. Null when exhausted.
   */
  nextOffsetId: number | null;
  messages: MessageHit[];
};

export type MessageFetchResult = {
  chat: ChatSummary;
  messages: MessageHit[];
};

export type JoinChatResult = {
  joined: boolean;
  /** True when the chat requires admin approval and a request was filed. */
  pendingApproval: boolean;
  chat: ChatSummary | null;
};
