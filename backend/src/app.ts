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
import {
  fetchMessagesHandler,
  joinChatHandler,
  meFetchMessagesHandler,
  meJoinChatHandler,
  meSearchChatsHandler,
  meSearchMessagesHandler,
  searchChatsHandler,
  searchMessagesHandler,
} from "@/controllers/chats";
import { connectPageHandler } from "@/controllers/connectPage";
import {
  aiPluginHandler,
  healthHandler,
  legalHandler,
  logoHandler,
  openApiHandler,
} from "@/controllers/discovery";
import { homePageHandler } from "@/controllers/home";
import {
  meDisconnectHandler,
  meStartQrHandler,
  meStatusHandler,
  meSubmitPasswordHandler,
} from "@/controllers/me";
import {
  authorizationServerMetadataHandler,
  authorizeDecisionHandler,
  authorizePageHandler,
  protectedResourceMetadataHandler,
  registerClientHandler,
  tokenHandler,
  updateClientHandler,
} from "@/controllers/oauth";
import { env } from "@/env";
import {
  mcpMethodNotAllowedHandler,
  mcpOauthPostHandler,
  mcpTokenPostHandler,
} from "@/mcp/routes";
import {
  httpErrorHandler,
  loggingMiddleware,
  notFoundHandler,
} from "@/middleware";

export function createApp(): express.Express {
  const app = express();

  app.use(express.json());
  // OAuth token/consent posts arrive form-encoded (RFC 6749).
  app.use(express.urlencoded({ extended: false }));
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

  // Chat discovery & research (requires an authorized Telegram session)
  app.get("/v1/accounts/:accountId/chats/search", searchChatsHandler);
  app.post("/v1/accounts/:accountId/chats/join", joinChatHandler);
  app.get("/v1/accounts/:accountId/messages/search", searchMessagesHandler);
  app.get("/v1/accounts/:accountId/messages/get", fetchMessagesHandler);

  // Hosted QR page (ChatGPT fallback / no-inline-image clients)
  app.get("/connect/:accountId", connectPageHandler);

  // Hosted MCP connector: OAuth on the bare URL (public), token URLs (legacy)
  app.post("/mcp", mcpOauthPostHandler);
  app.get("/mcp", mcpMethodNotAllowedHandler);
  app.delete("/mcp", mcpMethodNotAllowedHandler);
  app.post("/mcp/:accountToken", mcpTokenPostHandler);
  app.get("/mcp/:accountToken", mcpMethodNotAllowedHandler);
  app.delete("/mcp/:accountToken", mcpMethodNotAllowedHandler);

  // OAuth 2.1 authorization server
  app.get(
    "/.well-known/oauth-authorization-server",
    authorizationServerMetadataHandler,
  );
  app.get(
    "/.well-known/oauth-protected-resource",
    protectedResourceMetadataHandler,
  );
  app.get(
    "/.well-known/oauth-protected-resource/mcp",
    protectedResourceMetadataHandler,
  );
  app.post("/oauth/register", registerClientHandler);
  app.put("/oauth/register/:clientId", updateClientHandler);
  app.get("/oauth/authorize", authorizePageHandler);
  app.post("/oauth/authorize", authorizeDecisionHandler);
  app.post("/oauth/token", tokenHandler);

  // OAuth-scoped account endpoints (ChatGPT Actions with OAuth)
  app.get("/v1/me", meStatusHandler);
  app.post("/v1/me/qr", meStartQrHandler);
  app.post("/v1/me/password", meSubmitPasswordHandler);
  app.delete("/v1/me", meDisconnectHandler);
  app.get("/v1/me/chats/search", meSearchChatsHandler);
  app.post("/v1/me/chats/join", meJoinChatHandler);
  app.get("/v1/me/messages/search", meSearchMessagesHandler);
  app.get("/v1/me/messages/get", meFetchMessagesHandler);

  // Onboarding landing page — creates a connector URL in one click
  app.get("/", homePageHandler);

  // Discovery
  app.get("/.well-known/ai-plugin.json", aiPluginHandler);
  app.get("/openapi.json", openApiHandler);
  app.get("/logo.png", logoHandler);
  app.get("/legal", legalHandler);
  app.get("/privacy", legalHandler);
  app.get("/healthz", healthHandler);

  app.use(notFoundHandler);
  app.use(httpErrorHandler);

  return app;
}
