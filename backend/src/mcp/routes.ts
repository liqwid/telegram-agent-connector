import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { logger } from "common/logging";
import type { Request, RequestHandler, Response } from "express";

import { env } from "@/env";
import { buildMcpServer } from "@/mcp/server";
import type { AccountWithTokenHash } from "@/models/account";
import { findAccountByTokenHash } from "@/repositories/accountRepository";
import { hashAccountToken } from "@/services/accountTokens";
import { extractOauthAccount } from "@/utils/handler";

/**
 * Hosted MCP endpoints (Streamable HTTP, stateless):
 *
 *   POST /mcp                — OAuth: Authorization: Bearer <access token>.
 *                              The public connector URL; a 401 carries the
 *                              RFC 9728 pointer so MCP clients start the
 *                              OAuth flow on their own.
 *   POST /mcp/:accountToken  — legacy personal URLs from the landing page.
 *
 * Stateless mode means every request builds a fresh transport + server pair;
 * there is no session to track, which also makes the endpoint safe across
 * client reconnects. These are raw Express handlers (not the common Handler
 * builder): the MCP transport takes ownership of the response stream.
 */

const jsonRpcError = (res: Response, status: number, message: string): void => {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
};

const resolveTokenAccount = async (
  req: Request,
): Promise<AccountWithTokenHash | null> => {
  const accountToken = req.params.accountToken;
  if (typeof accountToken !== "string" || accountToken.length === 0) {
    return null;
  }
  return findAccountByTokenHash(hashAccountToken(accountToken));
};

const serveMcpRequest = async (
  req: Request,
  res: Response,
  account: AccountWithTokenHash,
): Promise<void> => {
  const server = buildMcpServer(account);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error("mcp: request failed", { accountId: account.id }, error);
    if (!res.headersSent) {
      jsonRpcError(res, 500, "Internal server error");
    }
  }
};

/** Legacy personal-URL endpoint: the token in the path is the credential. */
export const mcpTokenPostHandler: RequestHandler = async (req, res) => {
  const account = await resolveTokenAccount(req);
  if (!account) {
    logger.warn("mcp: rejected unknown connector token");
    jsonRpcError(
      res,
      401,
      "Unknown connector URL — create one on the landing page",
    );
    return;
  }
  await serveMcpRequest(req, res, account);
};

/**
 * Public OAuth endpoint. The WWW-Authenticate header on 401 is what makes
 * "paste https://…/mcp into Claude" work: the client discovers the
 * authorization server from it and runs the flow unprompted.
 */
export const mcpOauthPostHandler: RequestHandler = async (req, res) => {
  const auth = await extractOauthAccount(req);
  if (!auth) {
    res.setHeader(
      "WWW-Authenticate",
      `Bearer resource_metadata="${env.PUBLIC_BASE_URL}/.well-known/oauth-protected-resource"`,
    );
    jsonRpcError(res, 401, "Authorization required");
    return;
  }
  await serveMcpRequest(req, res, auth.account);
};

/** Stateless transport: no SSE stream to resume, no session to delete. */
export const mcpMethodNotAllowedHandler: RequestHandler = (_req, res) => {
  jsonRpcError(
    res,
    405,
    "Method not allowed — this MCP endpoint is stateless, use POST",
  );
};
