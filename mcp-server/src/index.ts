#!/usr/bin/env node
/**
 * MCP server bridging Claude to the Telegram Agent Connector backend. The QR
 * code is returned as inline image content so it renders directly in chat.
 *
 * Config:
 *   TELEGRAM_CONNECTOR_URL  backend base URL (default http://localhost:8300)
 *   TAC_CREDENTIALS_FILE    where the account id/token pointer lives
 *                           (default ~/.telegram-agent-connector.json)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  accountStatusSchema,
  backendUrl,
  chatSearchResultSchema,
  createdAccountSchema,
  fetchQrPng,
  joinChatResultSchema,
  messageFetchResultSchema,
  messageSearchResultSchema,
  requestJson,
  startedQrSchema,
} from "./backend";
import {
  type Credentials,
  deleteCredentials,
  loadCredentials,
  saveCredentials,
} from "./credentials";

const server = new McpServer(
  { name: "telegram-connector", version: "0.1.0" },
  {
    instructions: [
      "Connect a user's Telegram account. Flow: telegram_connect() -> show the",
      "returned QR image to the user -> telegram_status() until 'authorized'. If status is",
      "'password_needed', ask the user for their 2FA password and call telegram_password().",
      "If the QR expires, call telegram_qr() for a fresh one. No credentials are needed to",
      "start — the backend holds the Telegram application configuration.",
      "Once authorized, research tools unlock: telegram_search_chats finds public",
      "channels/groups by topic (including ones the user has not joined),",
      "telegram_search_messages searches messages globally or inside one chat (public chats",
      "work without joining; omit queries to browse recent messages; paginate with",
      "nextOffsetId for bulk research), telegram_fetch_messages pulls reply-thread context",
      "by message id, and telegram_join_chat joins a chat — ask the user before joining",
      "anything. Telegram search is literal: always pass several keyword variants (synonyms +",
      "local languages) and iterate like a web research loop: discover chats -> browse the",
      "best candidates -> search with refined variants, paging until you have enough evidence",
      "-> follow reply threads -> report with t.me links.",
    ].join(" "),
  },
);

type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

type ToolResult = { content: ToolContent[]; isError?: boolean };

const textContent = (text: string): ToolContent => ({ type: "text", text });

const imageContent = (png: Buffer): ToolContent => ({
  type: "image",
  data: png.toString("base64"),
  mimeType: "image/png",
});

const toolResult = (...content: ToolContent[]): ToolResult => ({ content });

/** Uniform error surface: backend/connection failures become readable text. */
const runTool = async (
  work: () => Promise<ToolResult>,
): Promise<ToolResult> => {
  try {
    return await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hint = message.includes("fetch failed")
      ? ` — is the backend running at ${backendUrl()}? Start it with 'docker compose up -d'.`
      : "";
    return {
      content: [textContent(`Error: ${message}${hint}`)],
      isError: true,
    };
  }
};

const requireCredentials = (): Credentials => {
  const credentials = loadCredentials();
  if (!credentials) {
    throw new Error("Not connected yet — call telegram_connect() first.");
  }
  return credentials;
};

const connectPageUrl = (credentials: Credentials): string =>
  `${credentials.backendUrl}/connect/${credentials.accountId}` +
  `?token=${encodeURIComponent(credentials.accountToken)}`;

const scanText = (credentials: Credentials, lead: string): string =>
  `${lead} Send the user this link — it shows the QR code and refreshes it automatically: ` +
  `${connectPageUrl(credentials)} — they should open it and scan with the Telegram app ` +
  "(Settings → Devices → Link Desktop Device). A QR image is also attached in case this " +
  "client displays images. Then call telegram_status() to check progress.";

async function findReusableAccount(): Promise<Credentials | null> {
  const credentials = loadCredentials();
  if (!credentials) return null;
  const status = await requestJson(accountStatusSchema, {
    method: "GET",
    path: `/v1/accounts/${credentials.accountId}`,
    credentials,
  }).catch(() => null);
  return status ? credentials : null;
}

async function connectAndShowQr(): Promise<ToolResult> {
  const existing = await findReusableAccount();
  const credentials =
    existing ??
    (await (async () => {
      const created = await requestJson(createdAccountSchema, {
        method: "POST",
        path: "/v1/accounts",
      });
      const fresh: Credentials = { backendUrl: backendUrl(), ...created };
      saveCredentials(fresh);
      return fresh;
    })());

  const started = await requestJson(startedQrSchema, {
    method: "POST",
    path: `/v1/accounts/${credentials.accountId}/qr`,
    credentials,
  });
  const png = await fetchQrPng(credentials);
  return toolResult(
    ...(png ? [imageContent(png)] : []),
    textContent(
      scanText(
        credentials,
        `QR login started (window ${started.loginTtlSeconds}s, code rotates ~every 30s).`,
      ),
    ),
  );
}

server.registerTool(
  "telegram_connect",
  {
    description:
      "Start connecting the user's Telegram account via QR login — no credentials needed. " +
      "Returns the QR code image — show it to the user and tell them to scan it from the " +
      "Telegram app (Settings → Devices → Link Desktop Device).",
    inputSchema: {},
  },
  () =>
    runTool(async () => {
      const existing = await findReusableAccount();
      if (existing) {
        const status = await requestJson(accountStatusSchema, {
          method: "GET",
          path: `/v1/accounts/${existing.accountId}`,
          credentials: existing,
        });
        if (status.status === "authorized") {
          return toolResult(
            textContent(
              "Already connected to Telegram as this account. Use telegram_status() for details, or telegram_logout() to disconnect first.",
            ),
          );
        }
      }
      return connectAndShowQr();
    }),
);

server.registerTool(
  "telegram_qr",
  {
    description:
      "Get the current QR code image for a login in progress (the code rotates ~every 30s).",
    inputSchema: {},
  },
  () =>
    runTool(async () => {
      const credentials = requireCredentials();
      const png = await fetchQrPng(credentials);
      if (!png) {
        return toolResult(
          textContent(
            "No active QR login (expired or already authorized). Check telegram_status(); reconnect with telegram_connect() if needed.",
          ),
        );
      }
      return toolResult(
        imageContent(png),
        textContent(scanText(credentials, "Fresh QR code.")),
      );
    }),
);

server.registerTool(
  "telegram_status",
  {
    description:
      "Check the Telegram connection status: not_started, waiting_scan, password_needed " +
      "(ask the user for their 2FA password), authorized, expired, or error.",
    inputSchema: {},
  },
  () =>
    runTool(async () => {
      const credentials = requireCredentials();
      const status = await requestJson(accountStatusSchema, {
        method: "GET",
        path: `/v1/accounts/${credentials.accountId}`,
        credentials,
      });
      const guidance =
        status.status === "waiting_scan"
          ? scanText(credentials, "Still waiting for the scan.")
          : status.status === "password_needed"
            ? "The account has 2FA — ask the user for their Telegram cloud password and call telegram_password()."
            : status.status === "authorized"
              ? "Connected — report the Telegram user back."
              : "No active login — call telegram_connect() to start one.";
      return toolResult(
        textContent(`${JSON.stringify(status, null, 2)}\n\n${guidance}`),
      );
    }),
);

server.registerTool(
  "telegram_password",
  {
    description:
      "Submit the user's Telegram 2FA (cloud) password to finish a login whose status is " +
      "'password_needed'. Never store or repeat the password.",
    inputSchema: { password: z.string().min(1) },
  },
  ({ password }) =>
    runTool(async () => {
      const credentials = requireCredentials();
      const status = await requestJson(accountStatusSchema, {
        method: "POST",
        path: `/v1/accounts/${credentials.accountId}/password`,
        credentials,
        body: { password },
      });
      return toolResult(textContent(JSON.stringify(status, null, 2)));
    }),
);

const searchParams = (
  entries: Record<string, string | string[] | undefined>,
): URLSearchParams =>
  Object.entries(entries).reduce((params, [name, value]) => {
    const values =
      value === undefined ? [] : typeof value === "string" ? [value] : value;
    values.forEach((one) => params.append(name, one));
    return params;
  }, new URLSearchParams());

server.registerTool(
  "telegram_search_chats",
  {
    description:
      "Find public Telegram channels and groups by topic. Telegram search is literal word " +
      "matching (no semantic search), so ALWAYS pass 2-5 short keyword variants covering " +
      "synonyms and the local language(s), e.g. ['Tbilisi second hand', 'барахолка Тбилиси', " +
      "'Tbilisi flea market'] — results are merged and deduped. Sorted joined-first, then by " +
      "member count; entries with isJoined=false are public communities the user has NOT " +
      "joined: browse or search them directly via telegram_search_messages(chat=@username), " +
      "and suggest the most relevant ones as chats to join (telegram_join_chat, only after " +
      "the user agrees).",
    inputSchema: {
      queries: z
        .array(z.string().min(1))
        .min(1)
        .max(5)
        .describe(
          "Keyword variants — synonyms and local-language forms, e.g. ['Tbilisi second hand', 'барахолка Тбилиси']",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max results per variant (default 15)"),
    },
  },
  ({ queries, limit }) =>
    runTool(async () => {
      const credentials = requireCredentials();
      const params = searchParams({
        q: queries,
        limit: limit === undefined ? undefined : String(limit),
      });
      const result = await requestJson(chatSearchResultSchema, {
        method: "GET",
        path: `/v1/accounts/${credentials.accountId}/chats/search?${params.toString()}`,
        credentials,
      });
      return toolResult(
        textContent(
          `${JSON.stringify(result, null, 2)}\n\n` +
            "Chats with isJoined=false are not part of the user's dialogs yet — you can still " +
            "browse/search public ones directly with telegram_search_messages(chat=@username), " +
            "or offer the user to join them with telegram_join_chat. Few results? Retry with " +
            "different variants — especially local-language ones.",
        ),
      );
    }),
);

server.registerTool(
  "telegram_search_messages",
  {
    description:
      "Research Telegram messages like a web search. Telegram matches words literally, so " +
      "pass 2-5 query variants (synonyms, other languages, singular/plural — e.g. " +
      "['юрист', 'адвокат', 'lawyer']); results merge newest-first with matchedQuery per hit. " +
      "Without 'chat': searches across all the user's joined dialogs. With 'chat' (@username " +
      "or t.me link): searches inside that chat — works for public chats the user has NOT " +
      "joined, pages internally up to limit=300 per variant, and returns variantStats " +
      "(Telegram's TOTAL match count per variant — how much evidence exists) plus a " +
      "nextOffsetId cursor: pass it back as offsetId to walk thousands of messages across " +
      "calls until nextOffsetId is null or you have enough evidence. With 'chat' and NO " +
      "queries: browses recent messages to learn the community's vocabulary first. For " +
      "aggregation research (e.g. 'best lawyer from reviews'), collect hits across chats, " +
      "follow replyToMsgId via telegram_fetch_messages to get the question each " +
      "recommendation answers, tally mentions, and cite t.me links.",
    inputSchema: {
      queries: z
        .array(z.string().min(1))
        .min(1)
        .max(5)
        .optional()
        .describe(
          "Query variants, e.g. ['юрист', 'адвокат', 'lawyer']. Omit (with chat set) to browse recent messages",
        ),
      chat: z
        .string()
        .min(1)
        .optional()
        .describe("Optional @username or t.me link to search/browse within"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(300)
        .optional()
        .describe(
          "Max messages per variant (default 20; up to 300 inside a chat — use high limits for bulk research)",
        ),
      offsetId: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "Resume cursor: the nextOffsetId from a previous chat-scoped call",
        ),
    },
  },
  ({ queries, chat, limit, offsetId }) =>
    runTool(async () => {
      if (!queries?.length && chat === undefined) {
        return {
          content: [
            textContent(
              "Error: provide queries (search) and/or chat (browse a chat's recent messages).",
            ),
          ],
          isError: true,
        };
      }
      const credentials = requireCredentials();
      const params = searchParams({
        q: queries,
        chat,
        limit: limit === undefined ? undefined : String(limit),
        offsetId: offsetId === undefined ? undefined : String(offsetId),
      });
      const result = await requestJson(messageSearchResultSchema, {
        method: "GET",
        path: `/v1/accounts/${credentials.accountId}/messages/search?${params.toString()}`,
        credentials,
      });
      return toolResult(textContent(JSON.stringify(result, null, 2)));
    }),
);

server.registerTool(
  "telegram_fetch_messages",
  {
    description:
      "Fetch specific messages from a chat by id (up to 100 per call). Use it to pull " +
      "reply-thread context around search hits: a hit's replyToMsgId is usually the " +
      "question a recommendation answers, and fetching ids around a hit (e.g. hit id ±5) " +
      "reconstructs the conversation. Works for public chats without joining.",
    inputSchema: {
      chat: z.string().min(1).describe("@username or t.me link of the chat"),
      ids: z
        .array(z.number().int().min(1))
        .min(1)
        .max(100)
        .describe("Message ids to fetch, e.g. replyToMsgId values"),
    },
  },
  ({ chat, ids }) =>
    runTool(async () => {
      const credentials = requireCredentials();
      const params = searchParams({ chat, ids: ids.join(",") });
      const result = await requestJson(messageFetchResultSchema, {
        method: "GET",
        path: `/v1/accounts/${credentials.accountId}/messages/get?${params.toString()}`,
        credentials,
      });
      return toolResult(textContent(JSON.stringify(result, null, 2)));
    }),
);

server.registerTool(
  "telegram_join_chat",
  {
    description:
      "Join a Telegram chat by public @username, t.me link, or invite link, on the user's " +
      "behalf. Joining is visible to the chat's members — always confirm with the user first. " +
      "Approval-gated chats return pendingApproval=true (a join request was filed).",
    inputSchema: {
      chat: z
        .string()
        .min(1)
        .describe("@username, t.me/name, or t.me/+invite link"),
    },
  },
  ({ chat }) =>
    runTool(async () => {
      const credentials = requireCredentials();
      const result = await requestJson(joinChatResultSchema, {
        method: "POST",
        path: `/v1/accounts/${credentials.accountId}/chats/join`,
        credentials,
        body: { chat },
      });
      return toolResult(textContent(JSON.stringify(result, null, 2)));
    }),
);

server.registerTool(
  "telegram_logout",
  {
    description:
      "Log out of Telegram, delete the stored session on the backend, and remove local " +
      "credentials. Destructive — confirm with the user first.",
    inputSchema: {},
  },
  () =>
    runTool(async () => {
      const credentials = requireCredentials();
      await requestJson(z.object({ deleted: z.string() }), {
        method: "DELETE",
        path: `/v1/accounts/${credentials.accountId}`,
        credentials,
      });
      deleteCredentials();
      return toolResult(
        textContent("Logged out and deleted the Telegram session."),
      );
    }),
);

await server.connect(new StdioServerTransport());
