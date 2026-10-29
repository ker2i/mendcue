// Migration runner: applies migrations/*.sql in order, records in schema_migrations.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

export async function migrate(databaseUrl: string): Promise<string[]> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const applied = new Set((await pool.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name as string));
    const done: string[] = [];
    for (const f of files) {
      if (applied.has(f)) continue;
      const sql = readFileSync(join(dir, f), "utf8");
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations(name) VALUES($1) ON CONFLICT DO NOTHING", [f]);
      done.push(f);
    }
    return done;
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
