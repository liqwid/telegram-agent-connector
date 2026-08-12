import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

import type { DB } from "@/db/types";
import { env } from "@/env";

export function createDb(connectionString: string): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString }),
    }),
  });
}

let instance: Kysely<DB> | undefined;

/** Lazily-created shared connection, opened on first use. */
export function getDb(): Kysely<DB> {
  if (!instance) {
    if (!env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    instance = createDb(env.DATABASE_URL);
  }
  return instance;
}
