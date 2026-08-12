import { Handler } from "common/http";
import { logger } from "common/logging";
import type { Request } from "express";

import type { AccountWithTokenHash } from "@/models/account";
import { findAccountWithTokenHashById } from "@/repositories/accountRepository";
import { verifyAccountToken } from "@/services/accountTokens";

/**
 * Who is calling an account-scoped endpoint. `accountToken` is kept so
 * responses can embed authenticated URLs (QR PNG, connect page) without the
 * server ever persisting the raw token.
 */
export type AccountAuth = {
  account: AccountWithTokenHash;
  accountToken: string;
};

/**
 * The bearer token, from the Authorization header or — for URLs that end up
 * in <img src> tags, where headers are impossible — a `token` query param.
 */
const extractToken = (req: Request): string | null => {
  const header = req.header("authorization");
  const bearer =
    header && header.toLowerCase().startsWith("bearer ")
      ? header.slice("bearer ".length).trim()
      : null;
  const queryToken = req.query.token;
  return bearer ?? (typeof queryToken === "string" ? queryToken : null);
};

/**
 * Authenticate an account-scoped call: the `:accountId` path segment names
 * the account, the token proves it. Unknown accounts and bad tokens fail
 * identically (401 via `handleAuthorized`), so ids are not enumerable.
 */
const extractAccount = async (req: Request): Promise<AccountAuth | null> => {
  const accountIdParam = req.params.accountId;
  const accountId = typeof accountIdParam === "string" ? accountIdParam : null;
  const accountToken = extractToken(req);
  if (!accountId || !accountToken) {
    logger.warn("accountAuth: missing account id or token", {
      path: req.originalUrl,
    });
    return null;
  }
  const account = await findAccountWithTokenHashById(accountId);
  if (!account || !verifyAccountToken(accountToken, account.tokenHash)) {
    logger.warn("accountAuth: unknown account or bad token", { accountId });
    return null;
  }
  return { account, accountToken };
};

/** Public endpoints (account creation, discovery documents). */
export const publicHandler = new Handler();

/** Account-scoped endpoints. 401s without a valid bearer token. */
// Explicit generic: with an async extractor, inference would otherwise resolve
// the auth payload to the promise itself rather than its resolved value.
export const accountHandler = new Handler().withAuth<AccountAuth>(
  extractAccount,
);
