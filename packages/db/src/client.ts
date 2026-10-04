import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema.ts";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: Db;
  /** "postgres" for a real server, "embedded" for PGlite (development, tests, free single-instance deploys). */
  kind: "postgres" | "embedded";
  close(): Promise<void>;
}

/** Default migrations folder (package-relative). Bundled servers pass their own path. */
export const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");

export interface DatabaseOptions {
  /** A Postgres connection string. When absent, an embedded PGlite database is used. */
  url?: string;
  /** PGlite data folder. Omit for an in-memory database (tests). */
  dataDir?: string;
  migrationsDir?: string;
}

/** Opens the database and applies any pending migrations. */
export async function openDatabase(options: DatabaseOptions = {}): Promise<Database> {
  const migrationsFolder = options.migrationsDir ?? MIGRATIONS_DIR;
  if (options.url) {
    const sql = postgres(options.url, { max: 5, onnotice: () => {} });
    const db = drizzlePostgres(sql, { schema });
    await migratePostgres(db, { migrationsFolder });
    return { db: db as unknown as Db, kind: "postgres", close: () => sql.end() };
  }
  if (options.dataDir) mkdirSync(options.dataDir, { recursive: true });
  const client = new PGlite(options.dataDir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return { db: db as unknown as Db, kind: "embedded", close: () => client.close() };
}
