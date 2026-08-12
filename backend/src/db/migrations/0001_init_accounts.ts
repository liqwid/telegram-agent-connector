import { type Kysely, sql } from "kysely";

/**
 * One row per connected Telegram account. `token_hash` authenticates the
 * plugin's bearer token (SHA-256, never the token itself); `*_enc` columns are
 * AES-256-GCM encrypted with ENCRYPTION_SECRET. `session_enc` is null until a
 * QR login completes.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("accounts")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("token_hash", "text", (col) => col.notNull())
    .addColumn("api_id_enc", "text", (col) => col.notNull())
    .addColumn("api_hash_enc", "text", (col) => col.notNull())
    .addColumn("session_enc", "text")
    .addColumn("tg_user_id", "text")
    .addColumn("tg_username", "text")
    .addColumn("tg_first_name", "text")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("authorized_at", "timestamptz")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("accounts").execute();
}
