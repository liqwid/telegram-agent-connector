import { randomBytes } from "node:crypto";

import { logger } from "common/logging";

import { OauthError } from "@/models/oauth";
import {
  consumeOauthCode,
  findOauthClientById,
  findOauthTokenByRefreshHash,
  insertOauthClient,
  insertOauthCode,
  insertOauthToken,
  rotateOauthToken,
} from "@/repositories/oauthRepository";
import {
  generateAccessToken,
  generateAuthorizationCode,
  generateClientId,
  generateClientSecret,
  generateRefreshToken,
  pkceChallengeMatches,
  secretMatches,
  sha256Hex,
} from "@/services/oauthTokens";
import { createAccount } from "@/useCases/createAccount";

const CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const OAUTH_SCOPE = "telegram";

// ---------------------------------------------------------------- registration

export type RegisteredClient = {
  client_id: string;
  client_secret?: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
};

/**
 * RFC 7591 dynamic client registration, open (no initial access token) as the
 * MCP spec expects. Public clients (`token_endpoint_auth_method: none`) get no
 * secret and must use PKCE; confidential ones get a secret, returned once.
 */
export async function registerOauthClient(input: {
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod:
    "none" | "client_secret_basic" | "client_secret_post";
}): Promise<RegisteredClient> {
  const clientId = generateClientId();
  const secret =
    input.tokenEndpointAuthMethod === "none" ? null : generateClientSecret();
  await insertOauthClient({
    id: clientId,
    secretHash: secret ? sha256Hex(secret) : null,
    name: input.clientName,
    redirectUris: input.redirectUris,
    authMethod: input.tokenEndpointAuthMethod,
  });
  logger.info("registerOauthClient: registered", {
    clientId,
    name: input.clientName,
    authMethod: input.tokenEndpointAuthMethod,
  });
  return {
    client_id: clientId,
    ...(secret ? { client_secret: secret } : {}),
    client_name: input.clientName,
    redirect_uris: input.redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: input.tokenEndpointAuthMethod,
  };
}

// --------------------------------------------------------------- authorization

export type AuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
};

/**
 * Validate the pieces of an authorization request that must NEVER cause a
 * redirect when wrong (unknown client, unregistered redirect URI).
 */
export async function validateAuthorizationRequest(
  request: AuthorizationRequest,
): Promise<{ clientName: string }> {
  const client = await findOauthClientById(request.clientId);
  if (!client) {
    throw new OauthError("invalid_client", "Unknown client_id");
  }
  if (!client.redirectUris.includes(request.redirectUri)) {
    throw new OauthError("invalid_request", "redirect_uri is not registered");
  }
  if (client.authMethod === "none" && !request.codeChallenge) {
    throw new OauthError(
      "invalid_request",
      "PKCE (code_challenge) is required for public clients",
    );
  }
  if (request.codeChallenge && request.codeChallengeMethod !== "S256") {
    throw new OauthError(
      "invalid_request",
      "Only code_challenge_method=S256 is supported",
    );
  }
  return { clientName: client.name };
}

/**
 * The consent decision: mint a connector account for this authorization and
 * bind a single-use code to it. Returns the code for the redirect.
 */
export async function approveAuthorization(
  request: AuthorizationRequest,
): Promise<string> {
  await validateAuthorizationRequest(request);
  const account = await createAccount();
  const code = generateAuthorizationCode();
  await insertOauthCode({
    codeHash: sha256Hex(code),
    clientId: request.clientId,
    accountId: account.accountId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  logger.info("approveAuthorization: code issued", {
    clientId: request.clientId,
    accountId: account.accountId,
  });
  return code;
}

// ----------------------------------------------------------------- token grant

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

const authenticateClient = async (input: {
  clientId: string;
  clientSecret: string | null;
}) => {
  const client = await findOauthClientById(input.clientId);
  if (!client) {
    throw new OauthError("invalid_client", "Unknown client_id");
  }
  if (client.authMethod !== "none") {
    if (
      !input.clientSecret ||
      !client.secretHash ||
      !secretMatches(input.clientSecret, client.secretHash)
    ) {
      throw new OauthError("invalid_client", "Client authentication failed");
    }
  }
  return client;
};

const issueTokenPair = async (
  clientId: string,
  accountId: string,
): Promise<TokenResponse> => {
  const accessToken = generateAccessToken();
  const refreshToken = generateRefreshToken();
  await insertOauthToken({
    id: randomBytes(9).toString("hex"),
    clientId,
    accountId,
    accessHash: sha256Hex(accessToken),
    refreshHash: sha256Hex(refreshToken),
    accessExpiresAt: new Date(Date.now() + ACCESS_TTL_MS),
    refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: OAUTH_SCOPE,
  };
};

export async function exchangeAuthorizationCode(input: {
  clientId: string;
  clientSecret: string | null;
  code: string;
  redirectUri: string;
  codeVerifier: string | null;
}): Promise<TokenResponse> {
  const client = await authenticateClient(input);
  const code = await consumeOauthCode(sha256Hex(input.code));
  if (!code || code.clientId !== client.id) {
    throw new OauthError("invalid_grant", "Unknown, used or expired code");
  }
  if (code.redirectUri !== input.redirectUri) {
    throw new OauthError("invalid_grant", "redirect_uri mismatch");
  }
  if (code.codeChallenge) {
    if (
      !input.codeVerifier ||
      !pkceChallengeMatches(input.codeVerifier, code.codeChallenge)
    ) {
      throw new OauthError("invalid_grant", "PKCE verification failed");
    }
  }
  logger.info("exchangeAuthorizationCode: tokens issued", {
    clientId: client.id,
    accountId: code.accountId,
  });
  return issueTokenPair(client.id, code.accountId);
}

export async function refreshAccessToken(input: {
  clientId: string;
  clientSecret: string | null;
  refreshToken: string;
}): Promise<TokenResponse> {
  const client = await authenticateClient(input);
  const stored = await findOauthTokenByRefreshHash(
    sha256Hex(input.refreshToken),
  );
  if (
    !stored ||
    stored.clientId !== client.id ||
    stored.refreshExpiresAt.getTime() < Date.now()
  ) {
    throw new OauthError("invalid_grant", "Unknown or expired refresh token");
  }
  const accessToken = generateAccessToken();
  const refreshToken = generateRefreshToken();
  await rotateOauthToken({
    id: stored.id,
    accessHash: sha256Hex(accessToken),
    refreshHash: sha256Hex(refreshToken),
    accessExpiresAt: new Date(Date.now() + ACCESS_TTL_MS),
    refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });
  logger.info("refreshAccessToken: rotated", {
    clientId: client.id,
    tokenId: stored.id,
  });
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: OAUTH_SCOPE,
  };
}
