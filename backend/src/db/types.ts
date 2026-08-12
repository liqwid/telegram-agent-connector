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

export interface DB {
  accounts: AccountsTable;
}
