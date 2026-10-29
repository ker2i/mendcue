// Shared test harness: seeded memory store + fixture provider + temp storage.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import type { Express } from "express";
import { MemoryStore } from "../src/db/memory.js";
import { seedStore } from "../src/db/seed.js";
import { createApp } from "../src/server/app.js";
import { registerIntegrationRoutes } from "../src/server/integration.js";
import { registerStaffRoutes } from "../src/server/staff.js";
import { registerPages } from "../src/server/pages.js";
import { FixtureProvider } from "../src/integrations/meta/fixture.js";
import { FilesystemStorage } from "../src/integrations/storage/storage.js";

export async function testApp(): Promise<{ app: Express; store: MemoryStore }> {
  const store = new MemoryStore();
  await seedStore(store);
  const storage = new FilesystemStorage(mkdtempSync(join(tmpdir(), "intake-test-")));
  const deps = { store, provider: new FixtureProvider(), storage, baseUrl: "http://test.local" };
  const app = createApp(deps);
  registerIntegrationRoutes(app, deps);
  registerStaffRoutes(app, deps);
  registerPages(app, deps);
  return { app, store };
}

export async function startSession(app: Express, publicKey: string): Promise<{ caseId: string; token: string; reference: string }> {
  process.env.NODE_ENV = "test";
  const r = await request(app).post("/api/v1/public/sessions").send({ publicKey, source: "widget" });
  if (r.status !== 201) throw new Error(`session start failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { caseId: r.body.caseId as string, token: r.body._devToken as string, reference: r.body.reference as string };
}

export async function say(app: Express, caseId: string, token: string, body: string, idem?: string) {
  const req = request(app).post(`/api/v1/cases/${caseId}/messages`).set("authorization", `Bearer ${token}`).send({ body });
  if (idem) req.set("idempotency-key", idem);
  return req;
}
