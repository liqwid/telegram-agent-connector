import type { Kysely } from "kysely";

/**
 * The hosted MCP endpoint authenticates by bearer token alone (no account id
 * in the URL besides it), so lookups go through token_hash — index it, and
 * make the uniqueness the code already assumes explicit.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createIndex("accounts_token_hash_unique")
    .unique()
    .on("accounts")
    .column("token_hash")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex("accounts_token_hash_unique").execute();
}
