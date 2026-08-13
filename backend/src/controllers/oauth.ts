import { HTTPStatus } from "common";
import type { Request } from "express";
import { z } from "zod";

import { env } from "@/env";
import { OauthError } from "@/models/oauth";
import {
  approveAuthorization,
  exchangeAuthorizationCode,
  OAUTH_SCOPE,
  refreshAccessToken,
  registerOauthClient,
  validateAuthorizationRequest,
} from "@/useCases/oauthFlows";
import { publicHandler } from "@/utils/handler";

/**
 * OAuth 2.1 authorization server surface. Discovery (RFC 8414 + 9728), open
 * dynamic client registration (RFC 7591), authorization-code + PKCE, and
 * refresh-token rotation — the auth contract MCP clients (claude.ai, ChatGPT)
 * and GPT Actions expect.
 */

// ------------------------------------------------------------------ discovery

export const authorizationServerMetadataHandler = publicHandler
  .parse({})
  .handle(async () => ({
    status: HTTPStatus.OK,
    body: {
      issuer: env.PUBLIC_BASE_URL,
      authorization_endpoint: `${env.PUBLIC_BASE_URL}/oauth/authorize`,
      token_endpoint: `${env.PUBLIC_BASE_URL}/oauth/token`,
      registration_endpoint: `${env.PUBLIC_BASE_URL}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: [
        "none",
        "client_secret_basic",
        "client_secret_post",
      ],
      scopes_supported: [OAUTH_SCOPE],
    },
  }));

/** RFC 9728 — how MCP clients discover the authorization server from a 401. */
export const protectedResourceMetadataHandler = publicHandler
  .parse({})
  .handle(async () => ({
    status: HTTPStatus.OK,
    body: {
      resource: `${env.PUBLIC_BASE_URL}/mcp`,
      authorization_servers: [env.PUBLIC_BASE_URL],
      scopes_supported: [OAUTH_SCOPE],
      bearer_methods_supported: ["header"],
    },
  }));

// --------------------------------------------------------------- registration

const registrationBodySchema = z.object({
  redirectUris: z.array(z.string().url()).min(1),
  clientName: z.string().min(1).max(200).default("MCP client"),
  tokenEndpointAuthMethod: z
    .enum(["none", "client_secret_basic", "client_secret_post"])
    .default("none"),
});

export const registerClientHandler = publicHandler
  .parse({ body: registrationBodySchema })
  .handle(async ({ body }) => ({
    status: HTTPStatus.CREATED,
    body: await registerOauthClient(body),
  }));

// -------------------------------------------------------------- authorization

const authorizeQuerySchema = z.object({
  responseType: z.string().optional(),
  clientId: z.string().min(1),
  redirectUri: z.string().min(1),
  state: z.string().optional(),
  scope: z.string().optional(),
  codeChallenge: z.string().optional(),
  codeChallengeMethod: z.string().optional(),
});

const consentPageHtml = (input: {
  clientName: string;
  query: z.infer<typeof authorizeQuerySchema>;
}): string => {
  const hidden = (name: string, value: string | undefined): string =>
    value === undefined
      ? ""
      : `<input type="hidden" name="${name}" value="${value.replace(/"/g, "&quot;")}">`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize ${input.clientName}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 26rem; margin: 0 auto;
         padding: 3rem 1rem; background: #f5f7fa; color: #1a1a2e; line-height: 1.5; }
  .card { background: #fff; border-radius: 12px; padding: 1.5rem;
          box-shadow: 0 2px 12px rgba(0,0,0,.08); }
  button { font-size: 1rem; padding: .6rem 1.4rem; border: 0; border-radius: 8px;
           background: #2481cc; color: #fff; cursor: pointer; width: 100%; }
</style>
</head>
<body>
<div class="card">
  <h2>Connect Telegram</h2>
  <p><b>${input.clientName}</b> wants to use the Telegram Agent Connector on your
  behalf: start a QR login for your Telegram account and act through the resulting
  session.</p>
  <p>Approving creates a connector account for this client. You'll link your
  Telegram by scanning a QR code afterwards, in the chat.</p>
  <form method="post" action="/oauth/authorize">
    ${hidden("client_id", input.query.clientId)}
    ${hidden("redirect_uri", input.query.redirectUri)}
    ${hidden("state", input.query.state)}
    ${hidden("scope", input.query.scope)}
    ${hidden("code_challenge", input.query.codeChallenge)}
    ${hidden("code_challenge_method", input.query.codeChallengeMethod)}
    <button type="submit">Approve</button>
  </form>
</div>
</body>
</html>`;
};

/** GET: validate and show the consent page. Never redirects on bad input. */
export const authorizePageHandler = publicHandler
  .parse({ query: authorizeQuerySchema })
  .handle(async ({ query }) => {
    if (query.responseType !== "code") {
      throw new OauthError(
        "invalid_request",
        "Only response_type=code is supported",
      );
    }
    const { clientName } = await validateAuthorizationRequest({
      clientId: query.clientId,
      redirectUri: query.redirectUri,
      codeChallenge: query.codeChallenge ?? null,
      codeChallengeMethod: query.codeChallengeMethod ?? null,
    });
    return {
      status: HTTPStatus.OK,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: consentPageHtml({ clientName, query }),
    };
  });

const decisionBodySchema = z.object({
  clientId: z.string().min(1),
  redirectUri: z.string().min(1),
  state: z.string().optional(),
  codeChallenge: z.string().optional(),
  codeChallengeMethod: z.string().optional(),
});

/** POST: the Approve click — mint the code and bounce back to the client. */
export const authorizeDecisionHandler = publicHandler
  .parse({ body: decisionBodySchema })
  .handle(async ({ body }) => {
    const code = await approveAuthorization({
      clientId: body.clientId,
      redirectUri: body.redirectUri,
      codeChallenge: body.codeChallenge ?? null,
      codeChallengeMethod: body.codeChallengeMethod ?? null,
    });
    const redirect = new URL(body.redirectUri);
    redirect.searchParams.set("code", code);
    if (body.state) redirect.searchParams.set("state", body.state);
    return {
      status: HTTPStatus.FOUND,
      headers: { Location: redirect.toString() },
    };
  });

// ---------------------------------------------------------------------- token

const tokenBodySchema = z.object({
  grantType: z.string(),
  code: z.string().optional(),
  redirectUri: z.string().optional(),
  codeVerifier: z.string().optional(),
  refreshToken: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
});

/** client_secret_basic support: credentials may arrive in the header. */
const basicAuthCredentials = (
  req: Request,
): { clientId: string; clientSecret: string } | null => {
  const header = req.header("authorization");
  if (!header || !header.toLowerCase().startsWith("basic ")) return null;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) return null;
  return {
    clientId: decodeURIComponent(decoded.slice(0, separator)),
    clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
  };
};

export const tokenHandler = publicHandler
  .parse({ body: tokenBodySchema })
  .handle(async ({ body, request }) => {
    const basic = basicAuthCredentials(request);
    const clientId = basic?.clientId ?? body.clientId;
    const clientSecret = basic?.clientSecret ?? body.clientSecret ?? null;
    if (!clientId) {
      throw new OauthError("invalid_client", "client_id is required");
    }

    if (body.grantType === "authorization_code") {
      if (!body.code || !body.redirectUri) {
        throw new OauthError(
          "invalid_request",
          "code and redirect_uri are required",
        );
      }
      return {
        status: HTTPStatus.OK,
        body: await exchangeAuthorizationCode({
          clientId,
          clientSecret,
          code: body.code,
          redirectUri: body.redirectUri,
          codeVerifier: body.codeVerifier ?? null,
        }),
      };
    }

    if (body.grantType === "refresh_token") {
      if (!body.refreshToken) {
        throw new OauthError("invalid_request", "refresh_token is required");
      }
      return {
        status: HTTPStatus.OK,
        body: await refreshAccessToken({
          clientId,
          clientSecret,
          refreshToken: body.refreshToken,
        }),
      };
    }

    throw new OauthError(
      "unsupported_grant_type",
      `Unsupported grant_type: ${body.grantType}`,
    );
  });
