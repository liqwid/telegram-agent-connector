import cors from "cors";
import express from "express";

import {
  accountStatusHandler,
  createAccountHandler,
  deleteAccountHandler,
  qrPngHandler,
  startQrHandler,
  submitPasswordHandler,
} from "@/controllers/accounts";
import { connectPageHandler } from "@/controllers/connectPage";
import {
  aiPluginHandler,
  healthHandler,
  legalHandler,
  logoHandler,
  openApiHandler,
} from "@/controllers/discovery";
import { homePageHandler } from "@/controllers/home";
import { env } from "@/env";
import { mcpMethodNotAllowedHandler, mcpPostHandler } from "@/mcp/routes";
import {
  httpErrorHandler,
  loggingMiddleware,
  notFoundHandler,
} from "@/middleware";

export function createApp(): express.Express {
  const app = express();

  app.use(express.json());
  app.use(loggingMiddleware);
  if (env.CORS_ORIGIN) {
    app.use(cors({ origin: env.CORS_ORIGIN.split(",") }));
  }

  // Account lifecycle
  app.post("/v1/accounts", createAccountHandler);
  app.post("/v1/accounts/:accountId/qr", startQrHandler);
  app.get("/v1/accounts/:accountId/qr.png", qrPngHandler);
  app.get("/v1/accounts/:accountId", accountStatusHandler);
  app.post("/v1/accounts/:accountId/password", submitPasswordHandler);
  app.delete("/v1/accounts/:accountId", deleteAccountHandler);

  // Hosted QR page (ChatGPT fallback / no-inline-image clients)
  app.get("/connect/:accountId", connectPageHandler);

  // Hosted MCP connector (Claude): personal URL, stateless Streamable HTTP
  app.post("/mcp/:accountToken", mcpPostHandler);
  app.get("/mcp/:accountToken", mcpMethodNotAllowedHandler);
  app.delete("/mcp/:accountToken", mcpMethodNotAllowedHandler);

  // Onboarding landing page — creates a connector URL in one click
  app.get("/", homePageHandler);

  // Discovery
  app.get("/.well-known/ai-plugin.json", aiPluginHandler);
  app.get("/openapi.json", openApiHandler);
  app.get("/logo.png", logoHandler);
  app.get("/legal", legalHandler);
  app.get("/healthz", healthHandler);

  app.use(notFoundHandler);
  app.use(httpErrorHandler);

  return app;
}
