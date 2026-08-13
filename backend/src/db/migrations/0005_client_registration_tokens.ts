import type { Kysely } from "kysely";

/**
 * RFC 7592 (dynamic client management): each registration gets a
 * registration access token (stored hashed) that authorizes later updates to
 * the client's redirect URIs — needed because ChatGPT regenerates a GPT's
 * OAuth callback whenever its OAuth settings change. Nullable: clients
 * registered before this migration simply cannot be updated.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("oauth_clients")
    .addColumn("registration_token_hash", "text")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("oauth_clients")
    .dropColumn("registration_token_hash")
    .execute();
}
