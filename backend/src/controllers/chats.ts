import { HTTPStatus } from "common";
import { z } from "zod";

import { accountPathSchema } from "@/controllers/accounts";
import { queryListSchema } from "@/models/chatSearch";
import { fetchMessages, MAX_FETCH_IDS } from "@/useCases/fetchMessages";
import { joinChat } from "@/useCases/joinChat";
import { searchChatMessages } from "@/useCases/searchChatMessages";
import { searchChats } from "@/useCases/searchChats";
import { accountHandler, oauthHandler } from "@/utils/handler";

/**
 * Chat discovery & research endpoints, in account-token and OAuth (/v1/me)
 * flavors — same use cases underneath. All require an authorized Telegram
 * session (409 NotConnectedError otherwise). `q` accepts repeated params or
 * comma-separated keyword variants — Telegram search is literal, so variants
 * are how callers get research-grade recall.
 */

export const searchChatsQuerySchema = z.object({
  q: queryListSchema,
  limit: z.coerce.number().int().min(1).max(50).default(15),
});

export const searchMessagesQuerySchema = z.object({
  // Absent + chat present = browse the chat's recent messages.
  q: queryListSchema.nullable().default(null),
  // Absent means global search across the user's joined dialogs.
  chat: z.string().min(1).nullable().default(null),
  // Per-variant budget; chat-scoped calls page internally up to this.
  limit: z.coerce.number().int().min(1).max(300).default(20),
  // Continue below this message id (from a previous nextOffsetId).
  offsetId: z.coerce.number().int().min(1).nullable().default(null),
});

/** Comma-separated message ids ("120,121,145"). */
export const idListSchema = z
  .string()
  .min(1)
  .transform((value, context) => {
    const ids = value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map(Number);
    if (ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id < 1)) {
      context.addIssue({
        code: "custom",
        message: "ids must be comma-separated positive integers",
      });
      return z.NEVER;
    }
    return ids.slice(0, MAX_FETCH_IDS);
  });

export const fetchMessagesQuerySchema = z.object({
  chat: z.string().min(1),
  ids: idListSchema,
});

export const joinChatBodySchema = z.object({
  chat: z.string().min(1),
});

export const searchChatsHandler = accountHandler
  .parse({ query: searchChatsQuerySchema, path: accountPathSchema })
  .handleAuthorized(async ({ auth, query }) => ({
    status: HTTPStatus.OK,
    body: await searchChats(auth.account, {
      queries: query.q,
      limit: query.limit,
    }),
  }));

export const searchMessagesHandler = accountHandler
  .parse({ query: searchMessagesQuerySchema, path: accountPathSchema })
  .handleAuthorized(async ({ auth, query }) => ({
    status: HTTPStatus.OK,
    body: await searchChatMessages(auth.account, {
      queries: query.q ?? [],
      chat: query.chat,
      limit: query.limit,
      offsetId: query.offsetId,
    }),
  }));

export const fetchMessagesHandler = accountHandler
  .parse({ query: fetchMessagesQuerySchema, path: accountPathSchema })
  .handleAuthorized(async ({ auth, query }) => ({
    status: HTTPStatus.OK,
    body: await fetchMessages(auth.account, {
      chat: query.chat,
      ids: query.ids,
    }),
  }));

export const joinChatHandler = accountHandler
  .parse({ body: joinChatBodySchema, path: accountPathSchema })
  .handleAuthorized(async ({ auth, body }) => ({
    status: HTTPStatus.OK,
    body: await joinChat(auth.account, { chat: body.chat }),
  }));

export const meSearchChatsHandler = oauthHandler
  .parse({ query: searchChatsQuerySchema })
  .handleAuthorized(async ({ auth, query }) => ({
    status: HTTPStatus.OK,
    body: await searchChats(auth.account, {
      queries: query.q,
      limit: query.limit,
    }),
  }));

export const meSearchMessagesHandler = oauthHandler
  .parse({ query: searchMessagesQuerySchema })
  .handleAuthorized(async ({ auth, query }) => ({
    status: HTTPStatus.OK,
    body: await searchChatMessages(auth.account, {
      queries: query.q ?? [],
      chat: query.chat,
      limit: query.limit,
      offsetId: query.offsetId,
    }),
  }));

export const meFetchMessagesHandler = oauthHandler
  .parse({ query: fetchMessagesQuerySchema })
  .handleAuthorized(async ({ auth, query }) => ({
    status: HTTPStatus.OK,
    body: await fetchMessages(auth.account, {
      chat: query.chat,
      ids: query.ids,
    }),
  }));

export const meJoinChatHandler = oauthHandler
  .parse({ body: joinChatBodySchema })
  .handleAuthorized(async ({ auth, body }) => ({
    status: HTTPStatus.OK,
    body: await joinChat(auth.account, { chat: body.chat }),
  }));
