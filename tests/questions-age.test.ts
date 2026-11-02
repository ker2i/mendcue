import { describe, expect, it } from "vitest";
import { findQuestion, isQuestionSelectable, nextQuestion } from "../src/domain/questions.js";

describe("appliance age", () => {
  it("retains historical question details but never selects age for new questions", () => {
    const age = findQuestion("q_age");
    expect(age).toBeDefined();
    expect(isQuestionSelectable(age!)).toBe(false);
    const askedIds = new Set<string>();
    const factKeys = new Set(["appliance_category", "problem_description", "service_zip", "brand", "model_number"]);
    for (let i = 0; i < 25; i++) {
      const q = nextQuestion({ factKeys, askedIds, category: "washer", hazardTypes: [], diagnosticCount: 0 });
      if (!q) break;
      expect(q.id).not.toBe("q_age");
      askedIds.add(q.id);
    }
  });
});
