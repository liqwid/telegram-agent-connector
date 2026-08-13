import { z } from "zod";

import { submitPasswordBodySchema } from "@/controllers/accounts";
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
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema);
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
