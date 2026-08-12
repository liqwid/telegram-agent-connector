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
  createdAccountSchema,
  fetchQrPng,
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

const scanInstructions = (loginTtlSeconds: number, connectPage: string) =>
  textContent(
    "Scan this QR with the Telegram app: Settings → Devices → Link Desktop Device. " +
      `The code rotates ~every 30s (login window ${loginTtlSeconds}s); call telegram_qr() ` +
      "if it expires, then telegram_status() to check progress. " +
      `Fallback link if the image is not visible: ${connectPage}`,
  );

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
    scanInstructions(started.loginTtlSeconds, started.connectPage),
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
        textContent("Fresh QR code — ask the user to scan it."),
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
      return toolResult(textContent(JSON.stringify(status, null, 2)));
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
