// Web entrypoint. Uses Postgres when DATABASE_URL is set, else seeded memory store.
import "dotenv/config";
import { Pool } from "pg";
import { createApp } from "./app.js";
import { registerIntegrationRoutes } from "./integration.js";
import { registerStaffRoutes } from "./staff.js";
import { registerPages } from "./pages.js";
import { MemoryStore } from "../db/memory.js";
import { PgStore } from "../db/pg.js";
import { seedStore } from "../db/seed.js";
import { FilesystemStorage } from "../integrations/storage/storage.js";
import { FixtureProvider } from "../integrations/meta/fixture.js";
import { MetaProvider } from "../integrations/meta/meta.js";
import type { ModelProvider } from "../integrations/meta/provider.js";

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.APP_BASE_URL ?? `http://localhost:${PORT}`;
const MEDIA_PATH = process.env.MEDIA_STORAGE_PATH ?? "./data/media";

function provider(): ModelProvider {
  const explicit = (process.env.MODEL_PROVIDER ?? "").toLowerCase();
  const key = process.env.MODEL_API_KEY ?? "";
  if (explicit !== "live" && (explicit === "fixture" || !key)) {
    console.log("[intake] model provider: FIXTURE (development only — never a live result)");
    return new FixtureProvider();
  }
  console.log("[intake] model provider: Meta live (muse-spark)");
  return new MetaProvider(key);
}

async function main(): Promise<void> {
  const store = process.env.DATABASE_URL
    ? new PgStore(new Pool({ connectionString: process.env.DATABASE_URL }))
    : new MemoryStore();
  if (!process.env.DATABASE_URL) {
    await seedStore(store);
    console.log("[intake] seeded in-memory demo store (set DATABASE_URL for Postgres)");
  }
  const deps = { store, provider: provider(), storage: new FilesystemStorage(MEDIA_PATH), baseUrl: BASE_URL };
  const app = createApp(deps);
  registerIntegrationRoutes(app, deps);
  registerStaffRoutes(app, deps);
  registerPages(app, deps);
  app.use((err: unknown, _req: unknown, res: { status: (n: number) => { json: (o: unknown) => void } }, _next: unknown) => {
    console.error("[intake] request error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong.", request_id: "server" } });
  });
  app.listen(PORT, () => console.log(`[intake] web listening on ${PORT} (${BASE_URL})`));
}

main().catch((e) => { console.error(e); process.exit(1); });
