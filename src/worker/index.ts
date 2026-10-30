import { writeFileSync } from "node:fs";
import "dotenv/config";
import { createRuntime } from "../config.js";
import { runWorker } from "./worker.js";

async function main(): Promise<void> {
  const deps = await createRuntime();
  console.log("[intake] worker starting");
  await runWorker({ ...deps, heartbeat: () => writeFileSync("/tmp/mendcue-worker-health.json", JSON.stringify({ completedCycleAt: Date.now() }), { mode: 0o600 }) }, { stopped: false });
}
main().catch((e) => { console.error("[intake] startup failed:", e instanceof Error ? e.message : "configuration error"); process.exit(1); });
