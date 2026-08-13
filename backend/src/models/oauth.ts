import { z } from "zod";

/**
 * OAuth 2.1 server records. All secrets (client secret, authorization code,
 * access/refresh tokens) are stored as SHA-256 hashes; the raw values exist
 * only in responses.
 */

export const oauthClientSchema = z.object({
  id: z.string(),
  secretHash: z.string().nullable(),
  name: z.string(),
  // Stored JSON-encoded; parsed to string[] at the boundary.
  redirectUris: z.string().transform((raw): string[] => {
    const parsed: unknown = JSON.parse(raw);
    return z.array(z.string()).parse(parsed);
  }),
  authMethod: z.enum(["none", "client_secret_basic", "client_secret_post"]),
  registrationTokenHash: z.string().nullable(),
  createdAt: z.coerce.date(),
});

export type OauthClient = z.infer<typeof oauthClientSchema>;

export const oauthCodeSchema = z.object({
  codeHash: z.string(),
  clientId: z.string(),
  accountId: z.string(),
  redirectUri: z.string(),
  codeChallenge: z.string().nullable(),
  expiresAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});

export type OauthCode = z.infer<typeof oauthCodeSchema>;

export const oauthTokenSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  accountId: z.string(),
  accessHash: z.string(),
  refreshHash: z.string(),
  accessExpiresAt: z.coerce.date(),
  refreshExpiresAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type OauthToken = z.infer<typeof oauthTokenSchema>;

/** RFC 6749 error surface; `middleware.ts` maps it to the right status. */
export class OauthError extends Error {
  constructor(
    public readonly code:
      | "invalid_request"
      | "invalid_client"
      | "invalid_grant"
      | "unauthorized_client"
      | "unsupported_grant_type"
      | "invalid_scope",
    description: string,
  ) {
    super(description);
    this.name = "OauthError";
  }
}
