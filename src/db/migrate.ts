// Migration runner: applies migrations/*.sql in order, records in schema_migrations.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

export interface MigrationFile { name: string; sql: string }

export function loadMigrationFiles(): MigrationFile[] {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => ({ name: f, sql: readFileSync(join(dir, f), "utf8") }));
}

export type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

// Both callbacks must use the same connection: DDL and its record commit together.
export async function applyMigrations(query: QueryFn, exec: (sql: string) => Promise<unknown>): Promise<string[]> {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const applied = new Set((await query("SELECT name FROM schema_migrations")).rows.map((r) => r.name as string));
  const done: string[] = [];
  for (const f of loadMigrationFiles()) {
    if (applied.has(f.name)) continue;
    await query("BEGIN");
    try {
      await exec(f.sql);
      await query("INSERT INTO schema_migrations(name) VALUES($1)", [f.name]);
      await query("COMMIT");
    } catch (error) {
      await query("ROLLBACK");
      throw error;
    }
    done.push(f.name);
  }
  return done;
}

export async function migrate(databaseUrl: string): Promise<string[]> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      return await applyMigrations(
        (sql, params) => client.query(sql, params as never[]) as Promise<{ rows: Array<Record<string, unknown>> }>,
        (sql) => client.query(sql)
      );
    } finally { client.release(); }
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1]?.endsWith("migrate.js");
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  migrate(url).then(
    (done) => { console.log(`Applied: ${done.join(", ") || "(none)"}`); },
    (e) => { console.error("Migration failed:", e); process.exit(1); }
  );
}
