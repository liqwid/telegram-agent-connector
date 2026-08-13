import { logger } from "common/logging";
import { parseItem, parseItemStrict } from "common/parseModels";

import { getDb } from "@/db";
import {
  type OauthClient,
  oauthClientSchema,
  type OauthCode,
  oauthCodeSchema,
  type OauthToken,
  oauthTokenSchema,
} from "@/models/oauth";

export async function insertOauthClient(input: {
  id: string;
  secretHash: string | null;
  name: string;
  redirectUris: string[];
  authMethod: string;
}): Promise<OauthClient> {
  logger.info("insertOauthClient: inserting", {
    clientId: input.id,
    name: input.name,
  });
  const row = await getDb()
    .insertInto("oauth_clients")
    .values({
      id: input.id,
      secret_hash: input.secretHash,
      name: input.name,
      redirect_uris: JSON.stringify(input.redirectUris),
      auth_method: input.authMethod,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return parseItemStrict(oauthClientSchema, row);
}

export async function findOauthClientById(
  clientId: string,
): Promise<OauthClient | null> {
  const row = await getDb()
    .selectFrom("oauth_clients")
    .selectAll()
    .where("id", "=", clientId)
    .executeTakeFirst();
  return parseItem(oauthClientSchema, row);
}

export async function insertOauthCode(input: {
  codeHash: string;
  clientId: string;
  accountId: string;
  redirectUri: string;
  codeChallenge: string | null;
  expiresAt: Date;
}): Promise<void> {
  await getDb()
    .insertInto("oauth_codes")
    .values({
      code_hash: input.codeHash,
      client_id: input.clientId,
      account_id: input.accountId,
      redirect_uri: input.redirectUri,
      code_challenge: input.codeChallenge,
      expires_at: input.expiresAt,
    })
    .execute();
}

/**
 * Single-use redemption: the row is deleted as it is read, so a replayed code
 * finds nothing. Returns null for unknown AND expired codes alike.
 */
export async function consumeOauthCode(
  codeHash: string,
): Promise<OauthCode | null> {
  const row = await getDb()
    .deleteFrom("oauth_codes")
    .where("code_hash", "=", codeHash)
    .returningAll()
    .executeTakeFirst();
  const code = parseItem(oauthCodeSchema, row);
  if (!code) return null;
  return code.expiresAt.getTime() >= Date.now() ? code : null;
}

export async function insertOauthToken(input: {
  id: string;
  clientId: string;
  accountId: string;
  accessHash: string;
  refreshHash: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}): Promise<void> {
  await getDb()
    .insertInto("oauth_tokens")
    .values({
      id: input.id,
      client_id: input.clientId,
      account_id: input.accountId,
      access_hash: input.accessHash,
      refresh_hash: input.refreshHash,
      access_expires_at: input.accessExpiresAt,
      refresh_expires_at: input.refreshExpiresAt,
      updated_at: new Date(),
    })
    .execute();
}

export async function findOauthTokenByAccessHash(
  accessHash: string,
): Promise<OauthToken | null> {
  const row = await getDb()
    .selectFrom("oauth_tokens")
    .selectAll()
    .where("access_hash", "=", accessHash)
    .executeTakeFirst();
  return parseItem(oauthTokenSchema, row);
}

export async function findOauthTokenByRefreshHash(
  refreshHash: string,
): Promise<OauthToken | null> {
  const row = await getDb()
    .selectFrom("oauth_tokens")
    .selectAll()
    .where("refresh_hash", "=", refreshHash)
    .executeTakeFirst();
  return parseItem(oauthTokenSchema, row);
}

/** Refresh rotation: both hashes are replaced in place, atomically. */
export async function rotateOauthToken(input: {
  id: string;
  accessHash: string;
  refreshHash: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}): Promise<void> {
  logger.info("rotateOauthToken: rotating", { tokenId: input.id });
  await getDb()
    .updateTable("oauth_tokens")
    .set({
      access_hash: input.accessHash,
      refresh_hash: input.refreshHash,
      access_expires_at: input.accessExpiresAt,
      refresh_expires_at: input.refreshExpiresAt,
      updated_at: new Date(),
    })
    .where("id", "=", input.id)
    .execute();
}

export async function deleteOauthTokensForAccount(
  accountId: string,
): Promise<void> {
  await getDb()
    .deleteFrom("oauth_tokens")
    .where("account_id", "=", accountId)
    .execute();
}
