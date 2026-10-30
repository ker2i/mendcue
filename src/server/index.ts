// Web entrypoint. Uses Postgres when DATABASE_URL is set, else seeded memory store.
import "dotenv/config";
import { createApp } from "./app.js";
import { registerIntegrationRoutes } from "./integration.js";
import { registerStaffRoutes } from "./staff.js";
import { registerPages } from "./pages.js";
import { createRuntime } from "../config.js";

async function main(): Promise<void> {
  const deps = await createRuntime();
  const { port: PORT, baseUrl: BASE_URL } = deps.config;
  const app = createApp(deps);
  registerIntegrationRoutes(app, deps);
  registerStaffRoutes(app, deps);
  registerPages(app, deps);
  app.use((err: unknown, _req: unknown, res: { status: (n: number) => { json: (o: unknown) => void } }, _next: unknown) => {
    console.error("[intake] request failed");
    res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong.", request_id: "server" } });
  });
  app.listen(PORT, () => console.log(`[intake] web listening on ${PORT} (${BASE_URL})`));
}

main().catch((e) => { console.error("[intake] startup failed:", e instanceof Error ? e.message : "configuration error"); process.exit(1); });
