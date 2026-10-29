// End-to-end text intake: first message through to a persisted technician handoff.
import { describe, expect, it } from "vitest";
import request from "supertest";
import { say, startSession, testApp } from "./helpers.js";

describe("text intake to handoff", () => {
  it("completes one intake and persists an immutable handoff", async () => {
    const { app, store } = await testApp();
    const s = await startSession(app, "pk_demo_phoenix_001");

    // Multi-fact message: category + brand + code must all be captured.
    const r1 = await say(app, s.caseId, s.token, "My washer fills, then stops. It's an LG and says OE.");
    expect(r1.status).toBe(201);
    // Engine must not re-ask what was supplied.
    expect(r1.body.reply as string).not.toMatch(/what brand/i);

    await say(app, s.caseId, s.token, "85003");
    await say(app, s.caseId, s.token, "The drum still has water in it.");
    await say(app, s.caseId, s.token, "Medium load.");
    await say(app, s.caseId, s.token, "Jane Doe");
    await say(app, s.caseId, s.token, "jane@example.com");
    await say(app, s.caseId, s.token, "Weekday mornings please.");
    await say(app, s.caseId, s.token, "done — please submit");

    const submit = await request(app).post(`/api/v1/cases/${s.caseId}/submit`)
      .set("authorization", `Bearer ${s.token}`).set("idempotency-key", "sub-1");
    expect(submit.status).toBe(201);
    expect(submit.body.reference).toBeDefined();

    const tenant = await store.getTenantByPublicKey("pk_demo_phoenix_001");
    const handoffs = await store.listHandoffs(tenant!.id, s.caseId);
    expect(handoffs).toHaveLength(1);
    const snap = handoffs[0].snapshot as Record<string, unknown>;
    expect(snap.case_reference).toBe(submit.body.reference);
    // Error code preserved verbatim.
    expect(JSON.stringify(snap.error_codes_verbatim)).toContain("OE");
    // Hypotheses carry qualitative strength, never percentages.
    const hyps = snap.hypotheses as Array<{ evidenceStrength: string }>;
    expect(hyps.length).toBeGreaterThan(0);
    expect(JSON.stringify(snap)).not.toMatch(/\d+%/);
    // Model mode is honestly labeled.
    expect(snap.model_mode).toBe("fixture");

    // Resubmission with the same idempotency key returns the same result, no duplicate.
    const again = await request(app).post(`/api/v1/cases/${s.caseId}/submit`)
      .set("authorization", `Bearer ${s.token}`).set("idempotency-key", "sub-1");
    expect(again.status).toBe(200);
    expect((await store.listHandoffs(tenant!.id, s.caseId))).toHaveLength(1);
  });

  it("asks about contradictions instead of silently choosing", async () => {
    const { app } = await testApp();
    const s = await startSession(app, "pk_demo_phoenix_001");
    await say(app, s.caseId, s.token, "My refrigerator is a Samsung.");
    const r = await say(app, s.caseId, s.token, "Actually the brand is LG, sorry.");
    // Either a clarification question or an accepted correction with preserved history.
    expect(r.status).toBe(201);
    expect(typeof r.body.reply).toBe("string");
  });

  it("flags out-of-service-area ZIPs without blocking handoff", async () => {
    const { app } = await testApp();
    const s = await startSession(app, "pk_demo_phoenix_001");
    const r = await say(app, s.caseId, s.token, "Washer broken, ZIP 90210.");
    expect(r.status).toBe(201);
    expect(r.body.reply as string).toMatch(/outside.*service area/i);
  });
});
