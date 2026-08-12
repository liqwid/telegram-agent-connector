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

const jsonBody = (schema: z.ZodType) => ({
  required: true,
  content: { "application/json": { schema: z.toJSONSchema(schema) } },
});

const jsonResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { type: "object" } } },
});

export function buildOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Telegram Agent Connector",
      version: "0.1.0",
      description:
        "Connects AI assistants to a user's Telegram account. Flow: create an account (no input needed), start a QR login, show the user the QR (connectPage link), poll status until 'authorized' — submitting the 2FA password if status becomes 'password_needed'. Authenticate account-scoped calls with 'Authorization: Bearer <accountToken>'.",
    },
    servers: [{ url: env.PUBLIC_BASE_URL }],
    paths: {
      "/v1/accounts": {
        post: {
          operationId: "createAccount",
          summary:
            "Register a new account slot. No input needed. Returns accountId and the one-time accountToken — keep both.",
          responses: { "201": jsonResponse("Account created") },
        },
      },
      "/v1/accounts/{accountId}/qr": {
        post: {
          operationId: "startQrLogin",
          summary:
            "Start (or restart) a QR login. Send the user the connectPage URL from the response — the page shows the QR and auto-refreshes it.",
          parameters: [accountIdParameter],
          responses: { "200": jsonResponse("QR login started") },
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
              content: { "image/png": {} },
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
          responses: { "200": jsonResponse("Current status") },
        },
        delete: {
          operationId: "disconnectAccount",
          summary:
            "Log out of Telegram and delete the account and its credentials. Destructive — confirm with the user first.",
          parameters: [accountIdParameter],
          responses: { "200": jsonResponse("Account deleted") },
        },
      },
      "/v1/accounts/{accountId}/password": {
        post: {
          operationId: "submitPassword",
          summary:
            "Complete a 2FA-protected login with the user's Telegram cloud password (when status is password_needed).",
          parameters: [accountIdParameter],
          requestBody: jsonBody(submitPasswordBodySchema),
          responses: { "200": jsonResponse("Password accepted") },
        },
      },
    },
    components: {
      securitySchemes: {
        accountToken: { type: "http", scheme: "bearer" },
      },
    },
  };
}
