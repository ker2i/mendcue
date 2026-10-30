// One startup policy shared by the web and worker. Never infer live mode from a key.
import { isAbsolute } from "node:path";
import { Pool } from "pg";
import { MemoryStore } from "./db/memory.js";
import { PgStore } from "./db/pg.js";
import { seedStore } from "./db/seed.js";
import { FilesystemStorage } from "./integrations/storage/storage.js";
import { FixtureProvider } from "./integrations/meta/fixture.js";
import { MetaProvider } from "./integrations/meta/meta.js";

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  const mode = env.MODEL_PROVIDER?.trim();
  if (mode !== "fixture" && mode !== "live") throw new Error("MODEL_PROVIDER must explicitly be fixture or live");
  if (mode === "live" && !env.MODEL_API_KEY?.trim()) throw new Error("MODEL_API_KEY is required in live mode");
  if (mode === "live" && ((env.META_MODEL && env.META_MODEL !== "muse-spark-1.3") ||
      (env.META_BASE_URL && env.META_BASE_URL !== "https://api.meta.ai/v1"))) throw new Error("Unreviewed Meta model or endpoint");
  if (production && !env.DATABASE_URL) throw new Error("Production requires DATABASE_URL");
  if (env.DATABASE_URL) {
    try { if (!["postgres:", "postgresql:"].includes(new URL(env.DATABASE_URL).protocol)) throw 0; }
    catch { throw new Error("DATABASE_URL must be a PostgreSQL URL"); }
  }
  if (production) {
    for (const name of ["SESSION_SECRET", "SECRET_ENCRYPTION_KEY"]) {
      const value = env[name] ?? "";
      if (value.length < 32 || /change_me|example|placeholder/i.test(value)) throw new Error(`${name} requires a non-placeholder secret of at least 32 characters`);
    }
    if(env.PRIVATE_ARTIFACT_ROOT && (!isAbsolute(env.PRIVATE_ARTIFACT_ROOT) || env.META_USAGE_LEDGER?.startsWith(env.PRIVATE_ARTIFACT_ROOT+"/")))throw new Error("PRIVATE_ARTIFACT_ROOT must be absolute and separate from the usage ledger");
    for (const name of ["MEDIA_STORAGE_PATH", "META_USAGE_LEDGER"]) {
      if (!env[name] || !isAbsolute(env[name]!)) throw new Error(`${name} must be an explicit absolute persistent path in production`);
    }
    try { if (new URL(env.APP_BASE_URL ?? "").protocol !== "https:") throw 0; }
    catch { throw new Error("Production APP_BASE_URL must use HTTPS"); }
    if (mode === "live" && !(Number(env.GLOBAL_AI_SPEND_LIMIT) > 0 && Number.isFinite(Number(env.GLOBAL_AI_SPEND_LIMIT)))) throw new Error("Live production requires an explicit positive GLOBAL_AI_SPEND_LIMIT");
  }
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535");
  return { mode, apiKey: env.MODEL_API_KEY ?? "", databaseUrl: env.DATABASE_URL,
    port, baseUrl: env.APP_BASE_URL ?? `http://localhost:${port}`, mediaPath: env.MEDIA_STORAGE_PATH ?? "./data/media" };
}

export async function createRuntime() {
  const config = readConfig();
  const store = config.databaseUrl ? new PgStore(new Pool({ connectionString: config.databaseUrl })) : new MemoryStore();
  if (!config.databaseUrl) await seedStore(store);
  const provider = config.mode === "live" ? new MetaProvider(config.apiKey) : new FixtureProvider();
  const storage = new FilesystemStorage(config.mediaPath);
  await storage.check();
  await store.listTenants();
  console.log(`[intake] provider=${provider.mode}; storage=${config.databaseUrl ? "postgres" : "memory (non-durable demo)"}`);
  return { config, store, provider, storage, baseUrl: config.baseUrl };
}
