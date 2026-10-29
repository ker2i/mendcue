// Background processing: leased turn jobs and signed webhook delivery.
import { describe, expect, it } from "vitest";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { MemoryStore } from "../src/db/memory.js";
import { seedStore } from "../src/db/seed.js";
import { createCase } from "../src/domain/intake.js";
import { FixtureProvider } from "../src/integrations/meta/fixture.js";
import { processOneJob } from "../src/worker/worker.js";
import { verifyWebhook } from "../src/integrations/webhooks/sign.js";

describe("worker", () => {
  it("processes a queued turn job exactly once", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const tenant = (await store.listTenants())[0];
    const deps = { store, provider: new FixtureProvider(), storage: { put: async () => { throw new Error("no"); }, get: async () => null } };
    const c = await createCase({ store, provider: deps.provider, storageGet: async () => null as unknown as Buffer }, tenant, "widget");
    const msgId = randomUUID();
    await store.addMessage({ id: msgId, tenantId: tenant.id, caseId: c.id, role: "customer", body: "Washer fills then stops 85003", createdAt: new Date().toISOString() });
    const now = new Date().toISOString();
    await store.enqueueJob({
      id: randomUUID(), tenantId: tenant.id, caseId: c.id, kind: "turn",
      payload: { messageId: msgId }, status: "pending", attempts: 0, maxAttempts: 3,
      leaseUntil: null, lastError: null, createdAt: now, updatedAt: now,
    });
    expect(await store.hasPendingTurnJob(c.id)).toBe(true);
    const did = await processOneJob(deps);
    expect(did).toBe(true);
    const messages = await store.listMessages(tenant.id, c.id);
    expect(messages.some((m) => m.role === "assistant")).toBe(true);
    // Second lease finds nothing (job done).
    const did2 = await processOneJob(deps);
    expect(did2).toBe(false);
  });

  it("delivers a signed webhook the receiver can verify", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const tenant = (await store.listTenants())[0];
    const secret = "test-secret-123";
    let received: { body: string; sig: string; ts: string } | null = null;
    const server = http.createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      received = { body: raw, sig: String(req.headers["x-intake-signature"] ?? ""), ts: String(req.headers["x-intake-timestamp"] ?? "") };
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    try {
      await store.saveEndpoint({ id: randomUUID(), tenantId: tenant.id, url: `http://127.0.0.1:${port}/hook`, secret, events: ["case.submitted"], active: true });
      const deps = { store, provider: new FixtureProvider(), storage: { put: async () => { throw new Error("no"); }, get: async () => null } };
      const c = await createCase({ store, provider: deps.provider, storageGet: async () => null as unknown as Buffer }, tenant, "widget");
      const now = new Date().toISOString();
      await store.enqueueJob({
        id: randomUUID(), tenantId: tenant.id, caseId: c.id, kind: "webhook",
        payload: { eventType: "case.submitted", handoffVersion: 1 }, status: "pending",
        attempts: 0, maxAttempts: 3, leaseUntil: null, lastError: null, createdAt: now, updatedAt: now,
      });
      const did = await processOneJob(deps);
      expect(did).toBe(true);
      expect(received).not.toBeNull();
      const { body, sig, ts } = received!;
      expect(verifyWebhook(secret, ts, body, sig.replace(/^sha256=/, ""))).toBe(true);
      const event = JSON.parse(body);
      expect(event.event_type).toBe("case.submitted");
      expect(event.case_id).toBe(c.id);
      const deliveries = await store.listDeliveries(tenant.id);
      expect(deliveries.some((d) => d.status === "delivered")).toBe(true);
    } finally {
      server.close();
    }
  });
});
