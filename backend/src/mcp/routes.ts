import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { logger } from "common/logging";
import type { Request, RequestHandler, Response } from "express";

import { buildMcpServer } from "@/mcp/server";
import type { AccountWithTokenHash } from "@/models/account";
import { findAccountByTokenHash } from "@/repositories/accountRepository";
import { hashAccountToken } from "@/services/accountTokens";

/**
 * Hosted MCP endpoint (Streamable HTTP, stateless): POST /mcp/:accountToken.
 * The token in the path is the whole credential — the personal connector URL
 * users paste into Claude. Stateless mode means every request builds a fresh
 * transport + server pair; there is no session to track, which also makes the
 * endpoint safe across client reconnects.
 *
 * These are raw Express handlers (not the common Handler builder): the MCP
 * transport takes ownership of the response stream.
 */

const jsonRpcError = (res: Response, status: number, message: string): void => {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
};

const resolveAccount = async (
  req: Request,
): Promise<AccountWithTokenHash | null> => {
  const accountToken = req.params.accountToken;
  if (typeof accountToken !== "string" || accountToken.length === 0) {
    return null;
  }
  return findAccountByTokenHash(hashAccountToken(accountToken));
};

export const mcpPostHandler: RequestHandler = async (req, res) => {
  const account = await resolveAccount(req);
  const accountToken = req.params.accountToken;
  if (!account || typeof accountToken !== "string") {
    logger.warn("mcp: rejected unknown connector token");
    jsonRpcError(
      res,
      401,
      "Unknown connector URL — create one on the landing page",
    );
    return;
  }

  const server = buildMcpServer(account, accountToken);
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

/** Stateless transport: no SSE stream to resume, no session to delete. */
export const mcpMethodNotAllowedHandler: RequestHandler = (_req, res) => {
  jsonRpcError(
    res,
    405,
    "Method not allowed — this MCP endpoint is stateless, use POST",
  );
};
