// Safety: deterministic hazard interruption, action gating, forbidden-action defense.
import { describe, expect, it } from "vitest";
import { containsForbiddenAction, screenHazards } from "../src/domain/safety.js";
import { findAction } from "../src/domain/questions.js";
import { say, startSession, testApp } from "./helpers.js";

describe("safety", () => {
  it("screens gas leaks deterministically", () => {
    const hits = screenHazards("I smell gas near the oven, like rotten eggs.");
    expect(hits.some((h) => h.type === "gas_leak")).toBe(true);
  });

  it("interrupts normal intake with the gas script immediately", async () => {
    const { app, store } = await testApp();
    const s = await startSession(app, "pk_demo_phoenix_001");
    const r = await say(app, s.caseId, s.token, "There is a strong gas smell by the dryer!");
    expect(r.status).toBe(201);
    expect(r.body.reply as string).toMatch(/leave the area/i);
    const tenant = await store.getTenantByPublicKey("pk_demo_phoenix_001");
    const c = await store.getCase(tenant!.id, s.caseId);
    expect(c!.safetyStatus).toBe("emergency");
  });

  it("interrupts sparking reports and stops optional checks", async () => {
    const { app } = await testApp();
    const s = await startSession(app, "pk_demo_phoenix_001");
    const r = await say(app, s.caseId, s.token, "The outlet is sparking when the fridge runs.");
    expect(r.body.reply as string).toMatch(/potentially dangerous|emergency services/i);
  });

  it("only approved actions are resolvable; forbidden text is detected", () => {
    expect(findAction("act_read_display")?.reviewStatus).toBe("approved");
    expect(findAction("act_remove_panel")).toBeUndefined();
    expect(containsForbiddenAction("Please remove the back panel and test live voltage.")).toBe(true);
    expect(containsForbiddenAction("Read the display exactly as shown.")).toBe(false);
  });
});
