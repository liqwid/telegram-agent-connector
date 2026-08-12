import "dotenv/config";

import { defineConfig } from "kysely-ctl";
import pg from "pg";

// kysely-ctl loads this config to run `kysely migrate:*`. The pool is lazy, so
// the CLI still loads even when DATABASE_URL is unset.
export default defineConfig({
  dialect: "pg",
  dialectConfig: {
    pool: new pg.Pool({
      connectionString: process.env.DATABASE_URL,
    }),
  },
  migrations: {
    migrationFolder: "src/db/migrations",
  },
});
