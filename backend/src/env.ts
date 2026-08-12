import "dotenv/config";

import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(8300),
  // Public URL of this backend — used to build the QR image / connect-page
  // links returned to plugins, and as the OpenAPI server URL.
  PUBLIC_BASE_URL: z.string().default("http://localhost:8300"),
  // The Telegram application this backend logs users in through — one pair
  // for the whole deployment, from https://my.telegram.org/apps (operator
  // secrets; end users never see or supply them).
  TELEGRAM_API_ID: z.coerce.number().int().positive(),
  TELEGRAM_API_HASH: z
    .string()
    .regex(/^[0-9a-f]{32}$/i, "must be the 32-hex-char api_hash"),
  // Secret used to AES-256-GCM encrypt Telegram session strings at rest. A
  // stored session is a logged-in Telegram device — treat this like a
  // production key.
  ENCRYPTION_SECRET: z.string().min(16),
  // Required by the Kysely repositories and migrations.
  DATABASE_URL: z.string().optional(),
  // How long one QR login attempt stays alive overall. Telegram rotates the
  // underlying token roughly every 30s; the login loop keeps re-issuing it
  // until this deadline.
  LOGIN_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  // Comma-separated origins allowed to call this service from a browser.
  // Unset means no CORS headers are emitted at all.
  CORS_ORIGIN: z.string().optional(),
  // Surfaced in the ChatGPT plugin manifest.
  CONTACT_EMAIL: z.string().default("opensource@example.com"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
