import { z } from "zod";

import { submitPasswordBodySchema } from "@/controllers/accounts";
import { joinChatBodySchema, sendMessageBodySchema } from "@/controllers/chats";
import { env } from "@/env";

/**
 * Hand-assembled OpenAPI 3.1 document for the six-endpoint surface. The
 * descriptions double as instructions for LLM-driven callers (Custom GPTs
 * import this spec directly).
 */

const accountIdParameter = {
  name: "accountId",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const tokenQueryParameter = {
  name: "token",
  in: "query",
  required: false,
  description:
    "The accountToken — alternative to the Authorization: Bearer header, for contexts (image URLs) where headers are impossible.",
  schema: { type: "string" },
};

const jsonBody = (schema: z.ZodType) => {
  // Zod stamps "$schema" into its output; OpenAPI validators (ChatGPT's
  // Actions importer among them) reject it inside a document — strip it.
  //
  // `io: "input"` describes what a CALLER may send. The default, "output",
  // describes what parsing produces — and there a field with `.default()` is
  // always present, so it lands in `required`. That inversion is not cosmetic:
  // ChatGPT obeys `required`, so a defaulted-nullable field like
  // `replyToMsgId` would force the model to invent a message id on every send.
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema, {
    io: "input",
  });
  return {
    required: true,
    content: { "application/json": { schema: jsonSchema } },
  };
};

// ChatGPT's schema validator requires `properties` on every object schema —
// responses are spelled out fully, no bare {type: "object"}.
const jsonResponse = (description: string, properties: object) => ({
  description,
  content: {
    "application/json": { schema: { type: "object", properties } },
  },
});

const statusProperties = {
  accountId: { type: "string" },
  status: {
    type: "string",
    description:
      "not_started | waiting_scan | password_needed | authorized | expired | error",
  },
  telegramUser: {
    type: "object",
    description: "Set once authorized",
    properties: {
      id: { type: "string" },
      username: { type: "string" },
      firstName: { type: "string" },
    },
  },
  qrExpiresAt: { type: "string" },
  passwordHint: { type: "string" },
  error: { type: "string" },
};

const startedQrProperties = {
  accountId: { type: "string" },
  status: { type: "string" },
  qrUrl: { type: "string", description: "Raw tg://login URL" },
  qrExpiresAt: { type: "string" },
  pngUrl: { type: "string", description: "QR image (PNG) URL" },
  connectPage: {
    type: "string",
    description: "Auto-refreshing hosted QR page — send this link to the user",
  },
  loginTtlSeconds: { type: "number" },
  passwordHint: { type: "string" },
  error: { type: "string" },
};

const createdAccountProperties = {
  accountId: { type: "string" },
  accountToken: {
    type: "string",
    description: "Bearer token for all account-scoped calls; shown only once",
  },
  next: { type: "string" },
};

const deletedProperties = {
  deleted: { type: "string", description: "Id of the deleted account" },
};

const stringQueryParameter = (
  name: string,
  required: boolean,
  description: string,
) => ({
  name,
  in: "query",
  required,
  description,
  schema: { type: "string" },
});

const chatSummaryProperties = {
  id: { type: "string" },
  title: { type: "string" },
  username: { type: "string" },
  kind: { type: "string", description: "channel | group | private" },
  memberCount: { type: "number" },
  isJoined: {
    type: "boolean",
    description:
      "false = a public chat the user has not joined — searchable directly via the messages/search endpoint, or suggest joining it",
  },
  link: { type: "string", description: "Public t.me link when available" },
};

const chatSummarySchema = { type: "object", properties: chatSummaryProperties };

const chatSearchResultProperties = {
  queries: { type: "array", items: { type: "string" } },
  chats: { type: "array", items: chatSummarySchema },
};

const messageHitProperties = {
  chat: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      username: { type: "string" },
    },
  },
  messageId: { type: "number" },
  sentAt: { type: "string" },
  senderName: { type: "string" },
  text: { type: "string" },
  replyToMsgId: {
    type: "number",
    description:
      "Id of the message this one replies to — fetch it for thread context",
  },
  matchedQuery: {
    type: "string",
    description: "Which query variant found this hit; absent in browse mode",
  },
  link: { type: "string", description: "t.me deep link when available" },
};

const messageListSchema = {
  type: "array",
  items: { type: "object", properties: messageHitProperties },
};

const messageSearchResultProperties = {
  queries: { type: "array", items: { type: "string" } },
  scope: { type: "string", description: "global | chat" },
  chat: chatSummarySchema,
  variantStats: {
    type: "array",
    description:
      "Per-variant coverage (chat scope only): totalCount is Telegram's total match count in the chat, fetched is how many this call returned",
    items: {
      type: "object",
      properties: {
        query: { type: "string" },
        totalCount: { type: "number" },
        fetched: { type: "number" },
      },
    },
  },
  nextOffsetId: {
    type: "number",
    description:
      "Pass as offsetId on the next call to page deeper into history; null when exhausted",
  },
  messages: messageListSchema,
};

const messageFetchResultProperties = {
  chat: chatSummarySchema,
  messages: messageListSchema,
};

const sentMessageProperties = {
  chat: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      username: { type: "string" },
    },
    description: "Who actually received it — verify it is the intended person",
  },
  messageId: { type: "number" },
  sentAt: { type: "string", description: "ISO timestamp Telegram recorded" },
  text: { type: "string", description: "The text as delivered, verbatim" },
  replyToMsgId: { type: "number" },
  link: { type: "string", description: "t.me link to the sent message" },
};

const joinChatResultProperties = {
  joined: { type: "boolean" },
  pendingApproval: {
    type: "boolean",
    description: "True when the chat requires admin approval to join",
  },
  chat: chatSummarySchema,
};

// ChatGPT's Actions importer caps BOTH operation summary and description at
// 300 chars each (enforced by spec.spec.ts). The full research-workflow
// guidance therefore lives in the GPT Instructions (chatgpt/gpt-instructions*)
// — these fields only carry the essentials.
const searchChatsSummary =
  "Find public Telegram channels/groups by topic keyword variants (comma-separated, max 5) — includes chats the user has not joined.";

const searchChatsDescription =
  "Telegram matches words literally: pass 2-5 comma-separated variants (synonyms + local languages); results merge and dedupe. isJoined=false entries are not joined yet — still searchable via messages/search with the chat param, or suggest joining.";

const searchMessagesSummary =
  "Search or browse Telegram messages: globally across joined dialogs, or inside one chat (public chats work without joining). Supports comma-separated query variants and offsetId pagination for bulk research.";

const searchMessagesDescription =
  "Pass 2-5 comma-separated variants in q; hits merge newest-first with matchedQuery. No chat: all joined dialogs. With chat: that chat only — variantStats has Telegram's total counts; pass nextOffsetId back as offsetId to page deeper. chat with no q: browse recent. replyToMsgId links thread context.";

const fetchMessagesSummary =
  "Fetch specific messages from a chat by id (up to 100) — pull reply-thread context around search hits. Works for public chats without joining.";

const fetchMessagesDescription =
  "A hit's replyToMsgId is usually the question a recommendation answers; fetching ids around a hit (e.g. hit id ±5) reconstructs the conversation. Also useful to read the full text of a message the search digest truncated.";

const sendMessageSummary =
  "Send a Telegram message as the user, to a person, group or channel (@username, t.me link, numeric chat id from a search result, or 'me' for Saved Messages). Irreversible and sent in the user's own name.";

const sendMessageDescription =
  "ALWAYS show the exact recipient and text and get an explicit go-ahead — it cannot be unsent, and in a group everyone sees it. Text is verbatim (no markdown). A chat id reaches any chat the account is in, private groups included; an invite link cannot — join first.";

const joinChatSummary =
  "Join a chat by public @username or t.me invite link. Visible to the chat's members — confirm with the user first.";

const searchChatsParameters = [
  stringQueryParameter(
    "q",
    true,
    "Comma-separated keyword variants (max 5), e.g. 'Tbilisi second hand, барахолка Тбилиси'",
  ),
  stringQueryParameter(
    "limit",
    false,
    "Max results per variant (1-50, default 15)",
  ),
];

const searchMessagesParameters = [
  stringQueryParameter(
    "q",
    false,
    "Comma-separated query variants (max 5), e.g. 'юрист, адвокат, lawyer'. Omit (with chat set) to browse the chat's recent messages",
  ),
  stringQueryParameter(
    "chat",
    false,
    "Optional @username or t.me link to search or browse within",
  ),
  stringQueryParameter(
    "limit",
    false,
    "Max messages per variant (1-300, default 20; high limits only work inside a chat)",
  ),
  stringQueryParameter(
    "offsetId",
    false,
    "Resume cursor: the nextOffsetId from a previous chat-scoped response",
  ),
];

const fetchMessagesParameters = [
  stringQueryParameter("chat", true, "@username or t.me link of the chat"),
  stringQueryParameter(
    "ids",
    true,
    "Comma-separated message ids (max 100), e.g. '120,121,145'",
  ),
];

export function buildOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Telegram Agent Connector",
      version: "0.1.0",
      description:
        "Connects AI assistants to a user's Telegram account. OAuth callers use the /v1/me endpoints (the token implies the account): start a QR login, show the user the connectPage link, poll status until 'authorized' — submitting the 2FA password if status becomes 'password_needed'. The /v1/accounts endpoints are the tokenless variant: create an account first, then authenticate with 'Authorization: Bearer <accountToken>'.",
    },
    servers: [{ url: env.PUBLIC_BASE_URL }],
    paths: {
      "/v1/accounts": {
        post: {
          operationId: "createAccount",
          summary:
            "Register a new account slot. No input needed. Returns accountId and the one-time accountToken — keep both.",
          responses: {
            "201": jsonResponse("Account created", createdAccountProperties),
          },
        },
      },
      "/v1/accounts/{accountId}/qr": {
        post: {
          operationId: "startQrLogin",
          summary:
            "Start (or restart) a QR login. Send the user the connectPage URL from the response — the page shows the QR and auto-refreshes it.",
          parameters: [accountIdParameter],
          responses: {
            "200": jsonResponse("QR login started", startedQrProperties),
          },
        },
      },
      "/v1/accounts/{accountId}/qr.png": {
        get: {
          operationId: "getQrPng",
          summary: "The current QR code as a PNG image.",
          parameters: [accountIdParameter, tokenQueryParameter],
          responses: {
            "200": {
              description: "PNG image",
              content: {
                "image/png": { schema: { type: "string", format: "binary" } },
              },
            },
          },
        },
      },
      "/v1/accounts/{accountId}": {
        get: {
          operationId: "getAccountStatus",
          summary:
            "Login/session status: not_started, waiting_scan, password_needed, authorized, expired, or error. Poll this while the user scans.",
          parameters: [accountIdParameter],
          responses: {
            "200": jsonResponse("Current status", statusProperties),
          },
        },
        delete: {
          operationId: "disconnectAccount",
          summary:
            "Log out of Telegram and delete the account and its credentials. Destructive — confirm with the user first.",
          parameters: [accountIdParameter],
          responses: {
            "200": jsonResponse("Account deleted", deletedProperties),
          },
        },
      },
      "/v1/me": {
        get: {
          operationId: "getMyStatus",
          summary:
            "OAuth: login/session status for the authenticated user: not_started, waiting_scan, password_needed, authorized, expired, or error. Poll this while the user scans.",
          responses: {
            "200": jsonResponse("Current status", statusProperties),
          },
        },
        delete: {
          operationId: "disconnectMe",
          summary:
            "OAuth: log out of Telegram and delete the authenticated user's account. Destructive — confirm with the user first.",
          responses: {
            "200": jsonResponse("Account deleted", deletedProperties),
          },
        },
      },
      "/v1/me/qr": {
        post: {
          operationId: "startMyQrLogin",
          summary:
            "OAuth: start (or restart) a QR login for the authenticated user. Send the user the connectPage URL from the response — the page shows the QR and auto-refreshes it.",
          responses: {
            "200": jsonResponse("QR login started", startedQrProperties),
          },
        },
      },
      "/v1/me/password": {
        post: {
          operationId: "submitMyPassword",
          summary:
            "OAuth: complete a 2FA-protected login with the user's Telegram cloud password (when status is password_needed).",
          requestBody: jsonBody(submitPasswordBodySchema),
          responses: {
            "200": jsonResponse("Password accepted", statusProperties),
          },
        },
      },
      "/v1/me/chats/search": {
        get: {
          operationId: "searchMyChats",
          summary: `OAuth: ${searchChatsSummary}`,
          description: searchChatsDescription,
          parameters: searchChatsParameters,
          responses: {
            "200": jsonResponse("Matching chats", chatSearchResultProperties),
          },
        },
      },
      "/v1/me/messages/search": {
        get: {
          operationId: "searchMyMessages",
          summary: `OAuth: ${searchMessagesSummary}`,
          description: searchMessagesDescription,
          parameters: searchMessagesParameters,
          responses: {
            "200": jsonResponse(
              "Matching messages",
              messageSearchResultProperties,
            ),
          },
        },
      },
      "/v1/me/messages/get": {
        get: {
          operationId: "fetchMyMessages",
          summary: `OAuth: ${fetchMessagesSummary}`,
          description: fetchMessagesDescription,
          parameters: fetchMessagesParameters,
          responses: {
            "200": jsonResponse(
              "Requested messages",
              messageFetchResultProperties,
            ),
          },
        },
      },
      "/v1/me/messages/send": {
        post: {
          operationId: "sendMyMessage",
          summary: `OAuth: ${sendMessageSummary}`,
          description: sendMessageDescription,
          requestBody: jsonBody(sendMessageBodySchema),
          responses: {
            "200": jsonResponse("The sent message", sentMessageProperties),
          },
        },
      },
      "/v1/me/chats/join": {
        post: {
          operationId: "joinMyChat",
          summary: `OAuth: ${joinChatSummary}`,
          requestBody: jsonBody(joinChatBodySchema),
          responses: {
            "200": jsonResponse("Join outcome", joinChatResultProperties),
          },
        },
      },
      "/v1/accounts/{accountId}/chats/search": {
        get: {
          operationId: "searchChats",
          summary: searchChatsSummary,
          description: searchChatsDescription,
          parameters: [accountIdParameter, ...searchChatsParameters],
          responses: {
            "200": jsonResponse("Matching chats", chatSearchResultProperties),
          },
        },
      },
      "/v1/accounts/{accountId}/messages/search": {
        get: {
          operationId: "searchMessages",
          summary: searchMessagesSummary,
          description: searchMessagesDescription,
          parameters: [accountIdParameter, ...searchMessagesParameters],
          responses: {
            "200": jsonResponse(
              "Matching messages",
              messageSearchResultProperties,
            ),
          },
        },
      },
      "/v1/accounts/{accountId}/messages/get": {
        get: {
          operationId: "fetchMessages",
          summary: fetchMessagesSummary,
          description: fetchMessagesDescription,
          parameters: [accountIdParameter, ...fetchMessagesParameters],
          responses: {
            "200": jsonResponse(
              "Requested messages",
              messageFetchResultProperties,
            ),
          },
        },
      },
      "/v1/accounts/{accountId}/messages/send": {
        post: {
          operationId: "sendMessage",
          summary: sendMessageSummary,
          description: sendMessageDescription,
          parameters: [accountIdParameter],
          requestBody: jsonBody(sendMessageBodySchema),
          responses: {
            "200": jsonResponse("The sent message", sentMessageProperties),
          },
        },
      },
      "/v1/accounts/{accountId}/chats/join": {
        post: {
          operationId: "joinChat",
          summary: joinChatSummary,
          parameters: [accountIdParameter],
          requestBody: jsonBody(joinChatBodySchema),
          responses: {
            "200": jsonResponse("Join outcome", joinChatResultProperties),
          },
        },
      },
      "/v1/accounts/{accountId}/password": {
        post: {
          operationId: "submitPassword",
          summary:
            "Complete a 2FA-protected login with the user's Telegram cloud password (when status is password_needed).",
          parameters: [accountIdParameter],
          requestBody: jsonBody(submitPasswordBodySchema),
          responses: {
            "200": jsonResponse("Password accepted", statusProperties),
          },
        },
      },
    },
    // No securitySchemes on purpose: GPT Actions configure auth in the editor
    // UI and are known to fail ("something went wrong") when the imported
    // schema also declares an oauth2 scheme. Auth expectations are described
    // in the operation summaries instead; MCP clients don't read this file.
  };
}
