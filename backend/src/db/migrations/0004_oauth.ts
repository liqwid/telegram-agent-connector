import { type Kysely, sql } from "kysely";

/**
 * OAuth 2.1 authorization server state. Secrets/codes/tokens are stored as
 * SHA-256 hashes only; `oauth_tokens` rows rotate in place on refresh.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("oauth_clients")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("secret_hash", "text")
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("redirect_uris", "text", (col) => col.notNull())
    .addColumn("auth_method", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable("oauth_codes")
    .addColumn("code_hash", "text", (col) => col.primaryKey())
    .addColumn("client_id", "text", (col) => col.notNull())
    .addColumn("account_id", "text", (col) => col.notNull())
    .addColumn("redirect_uri", "text", (col) => col.notNull())
    .addColumn("code_challenge", "text")
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable("oauth_tokens")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("client_id", "text", (col) => col.notNull())
    .addColumn("account_id", "text", (col) => col.notNull())
    .addColumn("access_hash", "text", (col) => col.notNull())
    .addColumn("refresh_hash", "text", (col) => col.notNull())
    .addColumn("access_expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("refresh_expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("oauth_tokens_access_hash_unique")
    .unique()
    .on("oauth_tokens")
    .column("access_hash")
    .execute();
  await db.schema
    .createIndex("oauth_tokens_refresh_hash_unique")
    .unique()
    .on("oauth_tokens")
    .column("refresh_hash")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("oauth_tokens").execute();
  await db.schema.dropTable("oauth_codes").execute();
  await db.schema.dropTable("oauth_clients").execute();
}
