import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "../src/db/migrate.js";

it("rolls back migration DDL when recording it fails, then safely retries", async () => {
  const db = new PGlite();
  await db.waitReady;
  const query = async (sql: string, params?: unknown[]) => {
    const result = await db.query(sql, params);
    return {rows: result.rows as Record<string, unknown>[]};
  };
  try {
    await expect(applyMigrations(async (sql,params) => {
      if (sql.startsWith("INSERT INTO schema_migrations") && params?.[0] === "007_durable_outbox.sql") {
        throw Error("injected migration-record failure");
      }
      return query(sql,params);
    }, sql => db.exec(sql))).rejects.toThrow("injected migration-record failure");
    const columns = await query("SELECT column_name FROM information_schema.columns WHERE table_name='background_jobs'");
    expect(columns.rows.map(row => row.column_name)).not.toContain("available_at");
    expect((await query("SELECT name FROM schema_migrations")).rows).toHaveLength(6);
    expect(await applyMigrations(query, sql => db.exec(sql))).toEqual(["007_durable_outbox.sql", "008_image_provenance.sql"]);
    expect((await query("SELECT available_at, lease_version FROM background_jobs")).rows).toEqual([]);
    expect(await applyMigrations(query, sql => db.exec(sql))).toEqual([]);
  } finally { await db.close(); }
}, 30000);
