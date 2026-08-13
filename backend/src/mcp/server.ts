import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CustomError } from "common";
import { logger } from "common/logging";
import { z } from "zod";

import { env } from "@/env";
import type { AccountWithTokenHash } from "@/models/account";
import { findAccountWithTokenHashById } from "@/repositories/accountRepository";
import { createPageToken } from "@/services/pageTokens";
import { renderQrPng } from "@/services/qrImage";
import { getActiveQrUrl } from "@/services/telegramLogin";
import { disconnectAccount } from "@/useCases/disconnectAccount";
import { getAccountStatus } from "@/useCases/getAccountStatus";
import { startQrLogin } from "@/useCases/startQrLogin";
import { submitLoginPassword } from "@/useCases/submitLoginPassword";

/**
 * Hosted MCP server: the same five tools as the local bridge, but running
 * inside the backend and bound to the account resolved from the connector
 * URL's bearer token. Users install it by pasting their personal URL into
 * Claude — no local software.
 *
 * A new server instance is built per request (stateless transport); all
 * durable state lives in the database and the in-memory QR login map.
 */

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
        "telegram_password(). If the QR expires, call telegram_qr(). No credentials are needed.",
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
