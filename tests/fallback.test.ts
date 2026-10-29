// Graceful model failure: intake continues deterministically, handoff marked.
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryStore } from "../src/db/memory.js";
import { seedStore } from "../src/db/seed.js";
import { createCase, processTurn, submitCase } from "../src/domain/intake.js";
import { ModelFailure, type ModelProvider } from "../src/integrations/meta/provider.js";

class FailingProvider implements ModelProvider {
  readonly mode = "live" as const;
  async extractIntakeTurn(): Promise<never> { throw new ModelFailure("timeout"); }
  async extractApplianceLabel(): Promise<never> { throw new ModelFailure("timeout"); }
  async assessCase(): Promise<never> { throw new ModelFailure("timeout"); }
}

describe("model failure fallback", () => {
  it("keeps intake usable and marks assessment unavailable", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const tenant = (await store.listTenants())[0];
    const deps = { store, provider: new FailingProvider(), storageGet: async () => null as unknown as Buffer };
    const c = await createCase(deps, tenant, "widget");
    const msgId = randomUUID();
    await store.addMessage({ id: msgId, tenantId: tenant.id, caseId: c.id, role: "customer", body: "Washer broken 85003", createdAt: new Date().toISOString() });
    const outcome = await processTurn(deps, tenant, c.id, msgId, "Washer broken 85003");
    expect(outcome.modelMode).toBe("fallback");
    expect(outcome.reply).toMatch(/can still collect your details/i);
    const { assessment } = await submitCase(deps, tenant, c.id);
    expect(assessment.status).toBe("assessment_unavailable");
    const handoffs = await store.listHandoffs(tenant.id, c.id);
    expect(handoffs).toHaveLength(1);
    expect((handoffs[0].snapshot as { assessment_status: string }).assessment_status).toBe("assessment_unavailable");
  });
});
