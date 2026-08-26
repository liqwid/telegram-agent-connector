import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CustomError } from "common";
import { logger } from "common/logging";
import { z } from "zod";

import { env } from "@/env";
import {
  connectorGuidance,
  imageContent,
  textContent,
  type ToolResult,
  toolResult,
  untrustedData,
} from "@/mcp/content";
import type { AccountWithTokenHash } from "@/models/account";
import { MAX_SEND_TEXT_LENGTH } from "@/models/messageSend";
import { findAccountWithTokenHashById } from "@/repositories/accountRepository";
import { createPageToken } from "@/services/pageTokens";
import { renderQrPng } from "@/services/qrImage";
import { getActiveQrUrl } from "@/services/telegramLogin";
import { disconnectAccount } from "@/useCases/disconnectAccount";
import { fetchMessages } from "@/useCases/fetchMessages";
import { getAccountStatus } from "@/useCases/getAccountStatus";
import { joinChat } from "@/useCases/joinChat";
import { searchChatMessages } from "@/useCases/searchChatMessages";
import { searchChats } from "@/useCases/searchChats";
import { sendMessage } from "@/useCases/sendMessage";
import { startQrLogin } from "@/useCases/startQrLogin";
import { submitLoginPassword } from "@/useCases/submitLoginPassword";

/**
 * Hosted MCP server: the same tools as the local bridge, but running
 * inside the backend and bound to the account resolved from the connector
 * URL's bearer token. Users install it by pasting their personal URL into
 * Claude — no local software.
 *
 * A new server instance is built per request (stateless transport); all
 * durable state lives in the database and the in-memory QR login map.
 */

/** Domain errors carry user-presentable messages; surface them as tool text. */
const runTool = async (
  work: () => Promise<ToolResult>,
): Promise<ToolResult> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CustomError) {
      return {
        content: [textContent(`Error: ${error.message}`)],
        isError: true,
      };
    }
    logger.error("mcp: tool failed", {}, error);
    return {
      content: [textContent("Error: internal backend error — try again")],
      isError: true,
    };
  }
};

/** Tool calls can arrive long after auth ran — always act on a fresh row. */
const freshAccount = async (
  account: AccountWithTokenHash,
): Promise<AccountWithTokenHash> =>
  (await findAccountWithTokenHashById(account.id)) ?? account;

/**
 * The hosted QR page — the one path that works in every client. Many MCP
 * clients (claude.ai among them) do not render image tool content, so every
 * tool response that expects a scan leads with this link; the inline PNG is
 * a bonus for clients that do display it. Links carry short-lived signed
 * page tokens, so they work for OAuth sessions too.
 */
const connectPageUrl = (accountId: string): string =>
  `${env.PUBLIC_BASE_URL}/connect/${accountId}` +
  `?token=${encodeURIComponent(createPageToken(accountId, env.LOGIN_TTL_SECONDS + 300))}`;

const scanText = (accountId: string, lead: string): string =>
  `${lead} Send the user this link — it shows the QR code and refreshes it automatically: ` +
  `${connectPageUrl(accountId)} — they should open it and scan with the Telegram app ` +
  "(Settings → Devices → Link Desktop Device). A QR image is also attached in case this client displays " +
  "images. Then call telegram_status() to check progress.";

const qrWithInstructions = async (
  account: AccountWithTokenHash,
): Promise<ToolResult> => {
  const started = await startQrLogin(account);
  const png = await renderQrPng(getActiveQrUrl(account.id));
  return toolResult(
    imageContent(png),
    textContent(
      scanText(
        account.id,
        `QR login started (window ${started.loginTtlSeconds}s, code rotates ~every 30s).`,
      ),
    ),
  );
};

export function buildMcpServer(account: AccountWithTokenHash): McpServer {
  const server = new McpServer(
    { name: "telegram-connector", version: "0.1.0" },
    {
      instructions:
        "Connect this user's Telegram account. Flow: telegram_connect() -> ALWAYS send the user " +
        "the QR page link from the tool response (inline images do not render in many clients — " +
        "never assume the user can see an attached image) -> telegram_status() until 'authorized'. " +
        "If status is 'password_needed', ask the user for their 2FA password and call " +
        "telegram_password(). If the QR expires, call telegram_qr(). No credentials are needed. " +
        "Once authorized, research tools unlock: telegram_search_chats finds public channels/groups " +
        "by topic (including ones the user has not joined), telegram_search_messages searches " +
        "messages globally or inside one chat (public chats work without joining; omit queries to " +
        "browse recent messages; paginate with nextOffsetId for bulk research), " +
        "telegram_fetch_messages pulls reply-thread context by message id, telegram_join_chat " +
        "joins a chat, and telegram_send_message writes a message as the user — for both of " +
        "those, show the user exactly what will happen and get an explicit go-ahead first. Telegram search is literal: always " +
        "pass several keyword variants (synonyms + local languages) and iterate like a web " +
        "research loop: discover chats -> browse the best candidates -> search with refined " +
        "variants, paging until you have enough evidence -> follow reply threads -> report with " +
        "t.me links.",
    },
  );

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
        const current = await freshAccount(account);
        if (current.sessionEnc) {
          return toolResult(
            textContent(
              "Already connected to Telegram. Use telegram_status() for details, or telegram_logout() to disconnect first.",
            ),
          );
        }
        return qrWithInstructions(current);
      }),
  );

  server.registerTool(
    "telegram_qr",
    {
      description:
        "Get a fresh QR code (image + link to the QR page) for a login in progress " +
        "(the code rotates ~every 30s).",
      inputSchema: {},
    },
    () =>
      runTool(async () =>
        toolResult(
          imageContent(await renderQrPng(getActiveQrUrl(account.id))),
          textContent(scanText(account.id, "Fresh QR code.")),
        ),
      ),
  );

  server.registerTool(
    "telegram_status",
    {
      description:
        "Check the Telegram connection status: not_started, waiting_scan, password_needed " +
        "(ask the user for their 2FA password), authorized, expired, or error. While a scan " +
        "is pending, the response repeats the QR page link — keep it in front of the user.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const status = getAccountStatus(await freshAccount(account));
        const guidance =
          status.status === "waiting_scan"
            ? scanText(account.id, "Still waiting for the scan.")
            : status.status === "password_needed"
              ? "The account has 2FA — ask the user for their Telegram cloud password and call telegram_password()."
              : status.status === "authorized"
                ? "Connected — report the Telegram user back."
                : "No active login — call telegram_connect() to start one.";
        return toolResult(
          textContent(JSON.stringify(status, null, 2)),
          connectorGuidance(guidance),
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
      runTool(async () =>
        toolResult(
          textContent(
            JSON.stringify(
              await submitLoginPassword(await freshAccount(account), password),
              null,
              2,
            ),
          ),
        ),
      ),
  );

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
        const result = await searchChats(await freshAccount(account), {
          queries,
          limit: limit ?? 15,
        });
        return toolResult(
          untrustedData(result),
          connectorGuidance(
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
        const result = await searchChatMessages(await freshAccount(account), {
          queries: queries ?? [],
          chat: chat ?? null,
          limit: limit ?? 20,
          offsetId: offsetId ?? null,
        });
        return toolResult(untrustedData(result));
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
        const result = await fetchMessages(await freshAccount(account), {
          chat,
          ids,
        });
        return toolResult(untrustedData(result));
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
        const result = await joinChat(await freshAccount(account), { chat });
        return toolResult(untrustedData(result));
      }),
  );

  server.registerTool(
    "telegram_send_message",
    {
      description:
        "Send a Telegram message AS THE USER — to a person, a group or a channel (@username, " +
        "t.me link, the numeric chat id from a search result, or 'me' for Saved Messages). " +
        "This is the only tool here that writes: it cannot be unsent, it is delivered to real " +
        "people, and it is attributed to the user personally. A GROUP IS NOT A DM — everyone " +
        "in it sees the message, so say plainly that it is a group and how many members it " +
        "has before asking. ALWAYS show the user the exact recipient and the exact text and " +
        "get an explicit go-ahead before calling it — never send a message the user has not " +
        "seen, never improvise a recipient, and never send to a list of people. A chat id " +
        "reaches any chat the account is already in, private groups included; an invite link " +
        "cannot be messaged — join it first. Text is delivered verbatim " +
        "(no markdown parsing). Pass replyToMsgId (a messageId from telegram_search_messages " +
        "or telegram_fetch_messages, in the SAME chat) to reply in-thread. The response echoes " +
        "what Telegram stored, with a t.me link when the chat has one.",
      inputSchema: {
        chat: z
          .string()
          .min(1)
          .describe(
            "Recipient: @username, t.me link, a numeric chat id from a search result " +
              "(reaches private groups too), or 'me' for the user's Saved Messages",
          ),
        text: z
          .string()
          .min(1)
          .max(MAX_SEND_TEXT_LENGTH)
          .describe(
            "The exact message text, as confirmed by the user (max 4096 chars)",
          ),
        replyToMsgId: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Reply to this message id in the same chat"),
      },
    },
    ({ chat, text, replyToMsgId }) =>
      runTool(async () => {
        const result = await sendMessage(await freshAccount(account), {
          chat,
          text,
          replyToMsgId: replyToMsgId ?? null,
        });
        // Not untrustedData: this is the connector's own delivery receipt, and
        // labelling it as other people's content would teach the model to
        // doubt the one confirmation the user needs to see.
        return toolResult(textContent(JSON.stringify(result, null, 2)));
      }),
  );

  server.registerTool(
    "telegram_logout",
    {
      description:
        "Log out of Telegram and delete this account and its stored session. Destructive — " +
        "confirm with the user first. The connector URL stops working afterwards; a new one " +
        "can be created on the backend's landing page.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        await disconnectAccount(await freshAccount(account));
        return toolResult(
          textContent(
            "Logged out and deleted the Telegram session. This connector URL is now defunct — remove it from Claude.",
          ),
        );
      }),
  );

  return server;
}
