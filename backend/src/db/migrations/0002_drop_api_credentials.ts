import type { Kysely } from "kysely";

/**
 * The Telegram api_id/api_hash moved from per-account encrypted columns to
 * backend configuration (TELEGRAM_API_ID / TELEGRAM_API_HASH) — one Telegram
 * application per deployment, users only scan the QR.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("accounts")
    .dropColumn("api_id_enc")
    .dropColumn("api_hash_enc")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  // Nullable on the way back: the original values are not recoverable.
  await db.schema
    .alterTable("accounts")
    .addColumn("api_id_enc", "text")
    .addColumn("api_hash_enc", "text")
    .execute();
}
