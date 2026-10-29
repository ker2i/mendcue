// REVIEW.md regression scenarios: R01 safety-before-confirmation, R09 loops.
import { describe, expect, it } from "vitest";
import request from "supertest";
import { say, startSession, testApp } from "./helpers.js";

function pngBytes(): Buffer {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([head, Buffer.alloc(64, 1)]);
}

describe("R01 hazard during model confirmation", () => {
  it("interrupts confirmation; hazard text never becomes an identifier", async () => {
    const { app, store } = await testApp();
    const s = await startSession(app, "pk_demo_phoenix_001");
    const up = await request(app).post(`/api/v1/cases/${s.caseId}/attachments`)
      .set("authorization", `Bearer ${s.token}`)
      .field("kind", "label_photo")
      .field("labelText", "MODEL ABC234")
      .attach("photo", pngBytes(), "label.png");
    expect(up.status).toBe(201);
    expect(up.body.reply as string).toMatch(/ABC234/);

    const r = await say(app, s.caseId, s.token, "I smell gas");
    expect(r.status).toBe(201);
    expect(r.body.reply as string).toMatch(/leave the area/i);
    expect(r.body.safetyStatus).toBe("emergency");

    const tenant = await store.getTenantByPublicKey("pk_demo_phoenix_001");
    const facts = await store.listFacts(tenant!.id, s.caseId);
    const models = facts.filter((f) => f.key === "model_number" && f.status !== "superseded");
    expect(models.every((f) => !String(f.value).toLowerCase().includes("gas"))).toBe(true);
    const c = await store.getCase(tenant!.id, s.caseId);
    expect(c!.safetyStatus).toBe("emergency");
  });

  it("unrelated chat during confirmation is treated as conversation", async () => {
    const { app, store } = await testApp();
    const s = await startSession(app, "pk_demo_phoenix_001");
    await request(app).post(`/api/v1/cases/${s.caseId}/attachments`)
      .set("authorization", `Bearer ${s.token}`)
      .field("kind", "label_photo")
      .field("labelText", "MODEL ABC234")
      .attach("photo", pngBytes(), "label.png");
    const r = await say(app, s.caseId, s.token, "actually the washer is in the garage");
    expect(r.status).toBe(201);
    expect(r.body.reply as string).not.toMatch(/model recorded as/i);
    const tenant = await store.getTenantByPublicKey("pk_demo_phoenix_001");
    const c = await store.getCase(tenant!.id, s.caseId);
    // Pending confirmation stays open for a later yes/correction.
    expect(c!.pendingAction).toMatchObject({ kind: "model_confirm", modelRaw: "ABC234" });
  });

  it("explicit confirm-model endpoint confirms and rejects junk", async () => {
    const { app } = await testApp();
    const s = await startSession(app, "pk_demo_phoenix_001");
    await request(app).post(`/api/v1/cases/${s.caseId}/attachments`)
      .set("authorization", `Bearer ${s.token}`)
      .field("kind", "label_photo")
      .field("labelText", "MODEL WM3900HBA")
      .attach("photo", pngBytes(), "label.png");
    const bad = await request(app).post(`/api/v1/cases/${s.caseId}/confirm-model`)
      .set("authorization", `Bearer ${s.token}`)
      .send({ confirm: true, correctedModel: "I smell gas" });
    expect(bad.status).toBe(400);
    const ok = await request(app).post(`/api/v1/cases/${s.caseId}/confirm-model`)
      .set("authorization", `Bearer ${s.token}`)
      .send({ confirm: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ confirmed: true, model: "WM3900HBA" });
  });
});

describe("R02 origins and CORS", () => {
  it("allows the platform hosted origin for session creation", async () => {
    const { app } = await testApp();
    const r = await request(app).post("/api/v1/public/sessions")
      .set("origin", "http://test.local")
      .send({ publicKey: "pk_demo_phoenix_001", source: "hosted" });
    expect(r.status).toBe(201);
    expect(r.headers["access-control-allow-origin"]).toBe("http://test.local");
  });

  it("answers preflight for allowlisted external origins only", async () => {
    const { app } = await testApp();
    const ok = await request(app).options("/api/v1/public/sessions")
      .set("origin", "http://localhost:3100")
      .set("access-control-request-method", "POST");
    expect(ok.status).toBe(204);
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3100");
    const bad = await request(app).options("/api/v1/public/sessions")
      .set("origin", "http://evil.example")
      .set("access-control-request-method", "POST");
    expect(bad.status).toBe(403);
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects session creation from a non-allowlisted origin", async () => {
    const { app } = await testApp();
    const r = await request(app).post("/api/v1/public/sessions")
      .set("origin", "http://evil.example")
      .send({ publicKey: "pk_demo_phoenix_001", source: "widget" });
    expect(r.status).toBe(403);
  });

  it("emits no CORS headers for staff or integration APIs", async () => {
    const { app } = await testApp();
    const r = await request(app).get("/api/v1/staff/cases").set("origin", "http://localhost:3100");
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("R03 stored markup cannot reach a staff HTML sink", () => {
  it("serves a staff page with no innerHTML sink for customer text", async () => {
    const { app } = await testApp();
    const s = await startSession(app, "pk_demo_phoenix_001");
    const marker = '<img src=x onerror="window.__m=1">';
    await say(app, s.caseId, s.token, `Fridge warm ${marker}`);
    // Data layer preserves the verbatim complaint for staff review...
    const agent = request.agent(app);
    await agent.post("/api/v1/staff/login").send({
      tenantSlug: "demo-phoenix-appliance", email: "tech@demo-phoenix.invalid", password: "demo-tech-1234",
    });
    const inbox = await agent.get("/api/v1/staff/cases");
    const row = (inbox.body.cases as Array<{ complaint: string }>).find((c) => c.complaint?.includes("__m=1"));
    expect(row).toBeDefined();
    // ...but clients build rows with text nodes, so markup stays inert text.
    for (const asset of ["/static/staff.js", "/static/intake.js", "/widget/v1.js"]) {
      const js = await request(app).get(asset);
      expect(js.status).toBe(200);
      expect(js.text).not.toContain("innerHTML");
    }
    const staffJs = await request(app).get("/static/staff.js");
    expect(staffJs.text).toContain("textContent");
    // Pages are served under a restrictive CSP with no inline scripts.
    const page = await request(app).get("/staff");
    expect(page.status).toBe(200);
    expect(page.headers["content-security-policy"] as string).toContain("script-src 'self'");
    expect(page.text).not.toContain("<script>");
  });
});

describe("R04 roles and scopes", () => {
  it("blocks readonly staff from mutating but allows reads", async () => {
    const { app, store } = await testApp();
    const tenant = await store.getTenantBySlug("demo-phoenix-appliance");
    const { randomUUID } = await import("node:crypto");
    const { hashPassword } = await import("../src/server/auth.js");
    await store.saveStaffUser({
      id: randomUUID(), tenantId: tenant!.id, email: "viewer@demo-phoenix.invalid",
      passwordHash: await hashPassword("demo-viewer-1234"), role: "readonly", name: "Viewer",
    });
    const s = await startSession(app, "pk_demo_phoenix_001");
    await say(app, s.caseId, s.token, "Fridge warm.");
    const login = await request(app).post("/api/v1/staff/login").send({
      tenantSlug: "demo-phoenix-appliance", email: "viewer@demo-phoenix.invalid", password: "demo-viewer-1234",
    });
    expect(login.status).toBe(200);
    const jar = ((login.headers["set-cookie"] as unknown as string[]) ?? []).map((c) => c.split(";")[0]).join("; ");
    const csrf = login.body.csrf as string;
    const inbox = await request(app).get("/api/v1/staff/cases").set("cookie", jar);
    expect(inbox.status).toBe(200);
    const c = await store.getCase(tenant!.id, s.caseId);
    const patch = await request(app).patch(`/api/v1/staff/cases/${s.caseId}`)
      .set("cookie", jar).set("x-csrf-token", csrf)
      .send({ workflowStatus: "closed", version: c!.version });
    expect(patch.status).toBe(403);
    const outcome = await request(app).post(`/api/v1/staff/cases/${s.caseId}/outcome`)
      .set("cookie", jar).set("x-csrf-token", csrf)
      .send({ rating: "useful_as_received" });
    expect(outcome.status).toBe(403);
    const unchanged = await store.getCase(tenant!.id, s.caseId);
    expect(unchanged!.workflowStatus).not.toBe("closed");
    expect(await store.getOutcome(tenant!.id, s.caseId)).toBeNull();
  });

  it("enforces service-key scopes on integration endpoints", async () => {
    const { app, store } = await testApp();
    const tenant = await store.getTenantBySlug("demo-phoenix-appliance");
    const { randomUUID } = await import("node:crypto");
    const { sha256 } = await import("../src/server/auth.js");
    await store.saveServiceCredential({
      id: randomUUID(), tenantId: tenant!.id, name: "empty",
      keyHash: sha256("sk_empty_key"), scopes: [], createdAt: new Date().toISOString(),
    });
    const denied1 = await request(app).post("/api/v1/integration/sessions")
      .set("authorization", "Bearer sk_empty_key").send({});
    expect(denied1.status).toBe(403);
    const s = await startSession(app, "pk_demo_phoenix_001");
    const denied2 = await request(app).get(`/api/v1/integration/cases/${s.caseId}/handoff`)
      .set("authorization", "Bearer sk_empty_key");
    expect(denied2.status).toBe(403);
    // Positive: fully scoped demo key still works.
    const ok = await request(app).post("/api/v1/integration/sessions")
      .set("authorization", "Bearer sk_demo_phoenix_001_SECRET").send({ externalReference: "CLM-1" });
    expect(ok.status).toBe(201);
  });
});

describe("R05 review and submission", () => {
  it("rejects an empty accidental submit; review shows missing info", async () => {
    const { app } = await testApp();
    const s = await startSession(app, "pk_demo_phoenix_001");
    const sub = await request(app).post(`/api/v1/cases/${s.caseId}/submit`)
      .set("authorization", `Bearer ${s.token}`);
    expect(sub.status).toBe(400);
    expect(sub.body.error.code).toBe("REVIEW_REQUIRED");
    const review = await request(app).get(`/api/v1/cases/${s.caseId}/review`)
      .set("authorization", `Bearer ${s.token}`);
    expect(review.status).toBe(200);
    expect(review.body.sections.length).toBeGreaterThanOrEqual(4);
    expect(review.body.missing).toContain("problem_description");
    expect(review.body.requiresIncompleteAck).toBe(true);
  });

  it("text confirmation in review submits exactly once", async () => {
    const { app, store } = await testApp();
    const s = await startSession(app, "pk_demo_phoenix_001");
    await say(app, s.caseId, s.token, "Washer fills then stops, LG, says OE.");
    await say(app, s.caseId, s.token, "85003");
    await say(app, s.caseId, s.token, "jane@example.com");
    const toReview = await say(app, s.caseId, s.token, "done");
    expect(toReview.body.phase).toBe("review");
    const confirmed = await say(app, s.caseId, s.token, "submit");
    expect(confirmed.body.phase).toBe("submitted");
    expect(confirmed.body.reply as string).toMatch(/reference is AI-/);
    const tenant = await store.getTenantByPublicKey("pk_demo_phoenix_001");
    expect((await store.listHandoffs(tenant!.id, s.caseId))).toHaveLength(1);
  });

  it("incomplete review requires explicit acknowledgement", async () => {
    const { app } = await testApp();
    const s = await startSession(app, "pk_demo_phoenix_001");
    await say(app, s.caseId, s.token, "Fridge warm.");
    await say(app, s.caseId, s.token, "done");
    const sub = await request(app).post(`/api/v1/cases/${s.caseId}/submit`)
      .set("authorization", `Bearer ${s.token}`);
    expect(sub.status).toBe(400);
    expect(sub.body.error.code).toBe("INCOMPLETE");
    const acked = await request(app).post(`/api/v1/cases/${s.caseId}/submit`)
      .set("authorization", `Bearer ${s.token}`)
      .send({ acknowledgeIncomplete: true });
    expect(acked.status).toBe(201);
  });
});

describe("R06 queued messages are never dropped", () => {
  it("processes two rapid messages, both affecting the case", async () => {
    const prev = process.env.SYNC_TURNS;
    process.env.SYNC_TURNS = "0";
    try {
      const { app, store } = await testApp();
      const { FixtureProvider } = await import("../src/integrations/meta/fixture.js");
      const { processOneJob } = await import("../src/worker/worker.js");
      const s = await startSession(app, "pk_demo_phoenix_001");
      const r1 = await say(app, s.caseId, s.token, "My washer fills then stops.");
      const r2 = await say(app, s.caseId, s.token, "ZIP 85003, brand LG.");
      expect(r1.status).toBe(202);
      expect(r2.status).toBe(202);
      const deps = { store, provider: new FixtureProvider(), storage: { put: async () => { throw new Error("no"); }, get: async () => null } };
      // Drain the queue (deferrals may take extra passes).
      for (let i = 0; i < 6; i++) await processOneJob(deps);
      const tenant = await store.getTenantByPublicKey("pk_demo_phoenix_001");
      const messages = await store.listMessages(tenant!.id, s.caseId);
      const assistant = messages.filter((m) => m.role === "assistant");
      expect(assistant.length).toBe(2);
      const facts = await store.listFacts(tenant!.id, s.caseId);
      const keys = new Set(facts.filter((f) => f.status !== "superseded").map((f) => f.key));
      expect(keys.has("problem_description")).toBe(true);
      expect(keys.has("service_zip")).toBe(true);
      expect(keys.has("brand")).toBe(true);
      // No duplicate customer facts from double processing.
      const problems = facts.filter((f) => f.key === "problem_description" && f.status !== "superseded");
      expect(problems.length).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.SYNC_TURNS;
      else process.env.SYNC_TURNS = prev;
    }
  });
});

describe("R07 bootstrap consume-once and expiry", () => {
  it("concurrent exchange succeeds exactly once", async () => {
    const { app } = await testApp();
    const started = await request(app).post("/api/v1/public/sessions")
      .send({ publicKey: "pk_demo_phoenix_001", source: "widget" });
    const code = started.body.bootstrapCode as string;
    const [a, b] = await Promise.all([
      request(app).post("/api/v1/sessions/exchange").send({ code }),
      request(app).post("/api/v1/sessions/exchange").send({ code }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 401]);
  });

  it("expired bootstrap codes cannot mint a capability", async () => {
    const { store } = await testApp();
    const tenant = await store.getTenantBySlug("demo-phoenix-appliance");
    const { randomUUID } = await import("node:crypto");
    const { sha256 } = await import("../src/server/auth.js");
    await store.createSession({
      id: randomUUID(), tenantId: tenant!.id, caseId: randomUUID(),
      tokenHash: sha256("ct_old"), bootstrapCodeHash: sha256("expired-code"),
      bootstrapUsed: false, createdAt: new Date(Date.now() - 3600_000).toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const got = await store.consumeBootstrap(sha256("expired-code"), new Date().toISOString());
    expect(got).toBeNull();
  });
});

describe("R08 serial never replaces the model", () => {
  it("keeps labeled model and serial separate", async () => {
    const { app, store } = await testApp();
    const s = await startSession(app, "pk_demo_phoenix_001");
    const r = await request(app).post(`/api/v1/cases/${s.caseId}/attachments`)
      .set("authorization", `Bearer ${s.token}`)
      .field("kind", "label_photo")
      .field("labelText", "LG MODEL WM3900HBA SERIAL 404KWXYZ12345")
      .attach("photo", pngBytes(), "label.png");
    expect(r.status).toBe(201);
    expect(r.body.reply as string).toMatch(/WM3900HBA/);
    expect(r.body.reply as string).not.toMatch(/404KWXYZ12345/);
    const tenant = await store.getTenantByPublicKey("pk_demo_phoenix_001");
    const facts = await store.listFacts(tenant!.id, s.caseId);
    const live = facts.filter((f) => f.status !== "superseded");
    expect(live.find((f) => f.key === "model_number_raw")?.value).toBe("WM3900HBA");
    expect(live.find((f) => f.key === "serial_number")?.value).toBe("404KWXYZ12345");
  });
});

describe("R12 provider output validation", () => {
  function stubFetch(payload: unknown, opts: { ok?: boolean; status?: number; raw?: string } = {}) {
    const body = opts.raw !== undefined ? opts.raw : JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] });
    return (async () => ({
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: async () => JSON.parse(body),
    })) as unknown as typeof fetch;
  }

  it("converts wrong-shape, malformed, and HTTP failures to ModelFailure", async () => {
    const { MetaProvider } = await import("../src/integrations/meta/meta.js");
    const { ModelFailure } = await import("../src/integrations/meta/provider.js");
    const realFetch = globalThis.fetch;
    const base = {
      tenantId: "t", caseId: "c", messageId: "m", messageText: "hi",
      knownFacts: [], askedQuestionIds: [], allowedQuestionIds: [], allowedActionIds: [],
      category: null, activeQuestion: null, recentMessages: [],
    };
    try {
      const p = new MetaProvider("test-key");
      globalThis.fetch = stubFetch({ proposedFacts: [] }); // missing required fields
      await expect(p.extractIntakeTurn(base)).rejects.toBeInstanceOf(ModelFailure);
      globalThis.fetch = stubFetch(null, { raw: "not json{{{" });
      await expect(p.extractIntakeTurn(base)).rejects.toBeInstanceOf(ModelFailure);
      globalThis.fetch = stubFetch(null, { ok: false, status: 500, raw: "{}" });
      await expect(p.extractIntakeTurn(base)).rejects.toBeInstanceOf(ModelFailure);
      // Valid shape passes and gains source attribution.
      globalThis.fetch = stubFetch({
        proposedFacts: [{ key: "brand", value: "LG", certainty: "explicit" }],
        hazardSignals: [], needsClarification: false, handoffRequested: false, unresolvedItems: [],
      });
      const out = await p.extractIntakeTurn(base);
      expect(out.proposedFacts[0]).toMatchObject({ key: "brand", sourceMessageId: "m" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("staff photos and settings", () => {
  it("serves photos to same-tenant staff and denies others", async () => {
    const { app } = await testApp();
    const s = await startSession(app, "pk_demo_phoenix_001");
    const up = await request(app).post(`/api/v1/cases/${s.caseId}/attachments`)
      .set("authorization", `Bearer ${s.token}`)
      .field("kind", "other")
      .attach("photo", pngBytes(), "p.png");
    const attId = up.body.attachmentId as string;
    const login = await request(app).post("/api/v1/staff/login").send({
      tenantSlug: "demo-phoenix-appliance", email: "tech@demo-phoenix.invalid", password: "demo-tech-1234",
    });
    const jar = ((login.headers["set-cookie"] as unknown as string[]) ?? []).map((c) => c.split(";")[0]).join("; ");
    const ok = await request(app).get(`/api/v1/staff/cases/${s.caseId}/attachments/${attId}`).set("cookie", jar);
    expect(ok.status).toBe(200);
    // Customer bearer token is not accepted on the staff route.
    const denied = await request(app).get(`/api/v1/staff/cases/${s.caseId}/attachments/${attId}`)
      .set("authorization", `Bearer ${s.token}`);
    expect(denied.status).toBe(401);
    // Other-tenant staff cannot reach it.
    const loginB = await request(app).post("/api/v1/staff/login").send({
      tenantSlug: "demo-harbor-warranty", email: "dispatch@demo-harbor.invalid", password: "demo-dispatch-1234",
    });
    const jarB = ((loginB.headers["set-cookie"] as unknown as string[]) ?? []).map((c) => c.split(";")[0]).join("; ");
    const cross = await request(app).get(`/api/v1/staff/cases/${s.caseId}/attachments/${attId}`).set("cookie", jarB);
    expect(cross.status).toBe(404);
  });

  it("exposes sanitized settings without secrets", async () => {
    const { app } = await testApp();
    const agent = request.agent(app);
    await agent.post("/api/v1/staff/login").send({
      tenantSlug: "demo-phoenix-appliance", email: "tech@demo-phoenix.invalid", password: "demo-tech-1234",
    });
    const r = await agent.get("/api/v1/staff/settings");
    expect(r.status).toBe(200);
    expect(r.body.tenant.slug).toBe("demo-phoenix-appliance");
    expect(JSON.stringify(r.body)).not.toContain("SECRET");
    expect(r.body.knowledge.chunkCount).toBe(5);
  });
});

describe("R09 correction and out-of-area decisions", () => {
  it("resolves a brand conflict without repeating the question", async () => {
    const { app } = await testApp();
    const s = await startSession(app, "pk_demo_phoenix_001");
    await say(app, s.caseId, s.token, "My refrigerator is a Samsung.");
    const conflict = await say(app, s.caseId, s.token, "Actually the brand is LG, sorry.");
    expect(conflict.body.reply as string).toMatch(/which is correct/i);
    const resolve = await say(app, s.caseId, s.token, "LG");
    expect(resolve.body.reply as string).toMatch(/now "LG"/i);
    expect(resolve.body.reply as string).not.toMatch(/which is correct/i);
  });

  it("out-of-area continue does not loop; submit reaches review", async () => {
    const { app } = await testApp();
    const s = await startSession(app, "pk_demo_phoenix_001");
    await say(app, s.caseId, s.token, "Washer broken, ZIP 90210.");
    const cont = await say(app, s.caseId, s.token, "Yes, please continue");
    expect(cont.body.reply as string).toMatch(/keep collecting/i);
    const next = await say(app, s.caseId, s.token, "It is a Whirlpool.");
    expect(next.body.reply as string).not.toMatch(/would you like me to continue/i);

    const s2 = await startSession(app, "pk_demo_phoenix_001");
    await say(app, s2.caseId, s2.token, "Dryer broken, ZIP 90210.");
    const sub = await say(app, s2.caseId, s2.token, "submit");
    expect(sub.body.phase).toBe("review");
    expect(sub.body.reply as string).toMatch(/here's what i have/i);
  });
});
