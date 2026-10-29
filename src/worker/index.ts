// Worker entrypoint.
import "dotenv/config";
import { Pool } from "pg";
import { MemoryStore } from "../db/memory.js";
import { PgStore } from "../db/pg.js";
import { seedStore } from "../db/seed.js";
import { FilesystemStorage } from "../integrations/storage/storage.js";
import { FixtureProvider } from "../integrations/meta/fixture.js";
import { MetaProvider } from "../integrations/meta/meta.js";
import { runWorker } from "./worker.js";

async function main(): Promise<void> {
  const store = process.env.DATABASE_URL
    ? new PgStore(new Pool({ connectionString: process.env.DATABASE_URL }))
    : new MemoryStore();
  if (!process.env.DATABASE_URL) await seedStore(store);
  const key = process.env.MODEL_API_KEY ?? "";
  const provider = (process.env.MODEL_PROVIDER ?? "").toLowerCase() === "live" && key
    ? new MetaProvider(key)
    : new FixtureProvider();
  console.log("[intake] worker starting");
  await runWorker({ store, provider, storage: new FilesystemStorage(process.env.MEDIA_STORAGE_PATH ?? "./data/media") }, { stopped: false });
}

main().catch((e) => { console.error(e); process.exit(1); });
