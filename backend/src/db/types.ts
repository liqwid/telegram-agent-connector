import type { ColumnType } from "kysely";

// Hand-written Kysely types (the schema is one table; codegen would need a
// live database on install). Keep in sync with src/db/migrations.

type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface AccountsTable {
  id: string;
  token_hash: string;
  session_enc: string | null;
  // Telegram user ids exceed 2^31; stored as text to avoid bigint parsing.
  tg_user_id: string | null;
  tg_username: string | null;
  tg_first_name: string | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  authorized_at: Timestamp | null;
}

export interface OauthClientsTable {
  id: string;
  secret_hash: string | null;
  name: string;
  // JSON-encoded string[] of exact redirect URIs.
  redirect_uris: string;
  auth_method: string;
  // RFC 7592 registration access token (hashed); authorizes client updates.
  registration_token_hash: string | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface OauthCodesTable {
  code_hash: string;
  client_id: string;
  account_id: string;
  redirect_uri: string;
  code_challenge: string | null;
  expires_at: Timestamp;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface OauthTokensTable {
  id: string;
  client_id: string;
  account_id: string;
  access_hash: string;
  refresh_hash: string;
  access_expires_at: Timestamp;
  refresh_expires_at: Timestamp;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: Timestamp;
}

export interface DB {
  accounts: AccountsTable;
  oauth_clients: OauthClientsTable;
  oauth_codes: OauthCodesTable;
  oauth_tokens: OauthTokensTable;
}
