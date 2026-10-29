# Evaluation scenarios (reviewed set)

Run against a seeded dev server (`MODEL_PROVIDER=fixture npm start`) or live
(`MODEL_PROVIDER=live MODEL_API_KEY=...`). The fixture scenarios assert
deterministic engine behavior; live runs are smoke checks only.

## Ordinary cases

1. **Washer OE (tenant A)** — "My washer fills, then stops. It's an LG and says OE."
   ZIP 85003 → drain observation → load → contact → submit.
   Expect: error code verbatim `OE`, no repeated brand question, handoff with
   category-level citation, required fields complete.
2. **Fridge warm (tenant A)** — "Fridge is warm but the freezer seems fine."
   Expect: cooling-scope question, display question, review summary, submit.
3. **Dishwasher standing water (tenant B)** — unrestricted ZIP accepted.
   Expect: stage + drain questions, tenant B branding and queue in handoff.

## Ambiguous / unsupported

4. **Ambiguous label** — upload label photo with text `MODEL ABC0O12`.
   Expect: ambiguous flag, confirmation prompt naming O vs 0, no exact-model
   knowledge level until the customer confirms letter by letter.
5. **Unknown brand/model** — answer "I don't know" to brand and model,
   "label inaccessible" for the photo.
   Expect: intake continues to human handoff with missing info marked.
6. **Unsupported category** — "My garbage disposal hums."
   Expect: general intake path, human handoff, no detailed troubleshooting
   implied.

## Hazard reports

7. **Gas smell** — "Strong gas smell by the dryer!"
   Expect: immediate gas script (leave area, no switches, call emergency +
   configured utility), `safetyStatus=emergency`, hazard event.
8. **Sparking outlet** — "The outlet sparks when the fridge runs."
   Expect: immediate escalation, no optional checks offered.

## Failure / edge

9. **Model outage** — run with a failing provider (see `tests/fallback.test.ts`).
   Expect: "I can still collect your details…", submission succeeds,
   `assessment_status=assessment_unavailable`, factual handoff persisted.
10. **Contradiction** — say brand Samsung, then brand LG.
    Expect: clarification question naming both values, original fact preserved
    as superseded after correction.
11. **Refresh / retry** — resend a message and a submit with the same
    `Idempotency-Key`. Expect: no duplicate message, no duplicate handoff.
12. **Cross-tenant** — use tenant B token on tenant A case id.
    Expect: 403; staff of B never sees A's cases.

## Grading (pilot)

Technician rates each handoff: useful as received / useful after corrections /
needed substantial follow-up / misleading or unusable; records confirmed issue
and whether hypotheses helped. Do not report accuracy or hours saved from
synthetic runs — compare against a manual-intake baseline on real pilot cases.
