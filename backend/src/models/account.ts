import { z } from "zod";

/**
 * A connected (or connecting) Telegram account. `sessionEnc` holds the
 * AES-256-GCM-encrypted gramjs StringSession (see services/encryption) once a
 * QR login completed — its presence is what "authorized" means durably. The
 * Telegram api_id/api_hash are deployment-level configuration (env), not
 * per-account data.
 */
export const accountSchema = z.object({
  id: z.string(),
  sessionEnc: z.string().nullable(),
  tgUserId: z.string().nullable(),
  tgUsername: z.string().nullable(),
  tgFirstName: z.string().nullable(),
  createdAt: z.coerce.date(),
  authorizedAt: z.coerce.date().nullable(),
});

export type Account = z.infer<typeof accountSchema>;

/** Internal shape for authentication: includes the stored bearer-token hash. */
export const accountWithTokenHashSchema = accountSchema.extend({
  tokenHash: z.string(),
});

export type AccountWithTokenHash = z.infer<typeof accountWithTokenHashSchema>;

export type NewAccount = {
  id: string;
  tokenHash: string;
};

export type AuthorizedSession = {
  sessionEnc: string;
  tgUserId: string;
  tgUsername: string | null;
  tgFirstName: string | null;
};
