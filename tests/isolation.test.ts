// Tenant isolation: no cross-tenant read/modify across cases, media, knowledge, jobs.
import { describe, expect, it } from "vitest";
import request from "supertest";
import { say, startSession, testApp } from "./helpers.js";

describe("tenant isolation", () => {
  it("tenant B token cannot read tenant A case", async () => {
    const { app } = await testApp();
    const a = await startSession(app, "pk_demo_phoenix_001");
    const b = await startSession(app, "pk_demo_harbor_001");
    await say(app, a.caseId, a.token, "Washer leaking.");
    const r = await request(app).get(`/api/v1/cases/${a.caseId}`).set("authorization", `Bearer ${b.token}`);
    expect(r.status).toBe(403);
  });

  it("tenant B cannot submit messages to tenant A case", async () => {
    const { app } = await testApp();
    const a = await startSession(app, "pk_demo_phoenix_001");
    const b = await startSession(app, "pk_demo_harbor_001");
    const r = await request(app).post(`/api/v1/cases/${a.caseId}/messages`)
      .set("authorization", `Bearer ${b.token}`).send({ body: "hijack" });
    expect(r.status).toBe(403);
  });

  it("staff of tenant B cannot see tenant A inbox", async () => {
    const { app } = await testApp();
    const agent = request.agent(app);
    const login = await agent.post("/api/v1/staff/login").send({
      tenantSlug: "demo-harbor-warranty", email: "dispatch@demo-harbor.invalid", password: "demo-dispatch-1234",
    });
    expect(login.status).toBe(200);
    const inbox = await agent.get("/api/v1/staff/cases");
    expect(inbox.status).toBe(200);
    // Harbor starts empty; Phoenix case must not leak.
    const a = await startSession(app, "pk_demo_phoenix_001");
    await say(app, a.caseId, a.token, "Fridge warm.");
    const inbox2 = await agent.get("/api/v1/staff/cases");
    expect((inbox2.body.cases as unknown[]).map((c) => (c as { id: string }).id)).not.toContain(a.caseId);
  });

  it("service key of tenant A cannot fetch tenant B handoff", async () => {
    const { app } = await testApp();
    const b = await startSession(app, "pk_demo_harbor_001");
    const r = await request(app).get(`/api/v1/integration/cases/${b.caseId}/handoff`)
      .set("authorization", "Bearer sk_demo_phoenix_001_SECRET");
    expect(r.status).toBe(404); // scoped read finds nothing outside its tenant
  });

  it("private knowledge stays tenant-scoped in retrieval", async () => {
    const { store } = await testApp();
    const a = await store.getTenantBySlug("demo-phoenix-appliance");
    const b = await store.getTenantBySlug("demo-harbor-warranty");
    await store.saveDocument({
      id: "doc_private_a", tenantId: a!.id, visibility: "tenant_private",
      publisher: "Tenant A", sourceUrl: null, documentType: "procedure", title: "A private",
      language: "en", brand: null, explicitModels: [], explicitFamilies: [],
      retrievedAt: new Date().toISOString(), hash: "x", version: "v1",
      reviewStatus: "approved", reviewedBy: "a",
    });
    const seenByB = await store.listDocuments(b!.id);
    expect(seenByB.map((d) => d.id)).not.toContain("doc_private_a");
    const seenByA = await store.listDocuments(a!.id);
    expect(seenByA.map((d) => d.id)).toContain("doc_private_a");
  });
});
