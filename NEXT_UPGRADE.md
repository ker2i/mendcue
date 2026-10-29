# MendCue — next upgrade, product redesign, and evidence plan

Prepared: October 29, 2026.  
Project directory: `/home/zemmli/appliance-intake`  
GitHub organization/repository: `ker2i/mendcue`  
Repository snapshot inspected for this handoff: `1d4e969`.

## 1. Start here

This document is the implementation brief for the next coding session. It follows the original [DESIGN.md](DESIGN.md) and the first [REVIEW.md](REVIEW.md).

**The next objective is to make MendCue demonstrably useful to an actual appliance technician and deliver a convincing hackathon demonstration.**

Product promise:

> MendCue turns a messy customer report into a technician-approved service brief before the visit.

The Phoenix pilot is a solo repair technician. The shared architecture still supports repair companies, home-warranty firms, and insurers through tenant configuration, an embedded widget, and an API. Keep that foundation. Focus this release on the first technician's workflow.

The owner will continue in another session. The next agent must read this file and inspect the current repository before making changes. This file is a plan, not a claim that the listed capabilities or results already exist.

## 2. Current state and what to preserve

Muse has implemented work responding to the first review. Recent commits at preparation time:

- `7a965af`: safety-first turns, pending decisions, queue protocol, review policy.
- `c9352f9`: PostgreSQL/RLS paths, provider validation, roles/scopes, safe rendering, hardening.
- `1d4e969`: redesigned screens, message handshake, browser suite, deployment changes.

The repository now includes:

- Shared tenant-aware Express/TypeScript API and intake engine.
- A hosted business page, embedded customer interface, and staff workspace.
- UI code split into `src/server/ui/` and page shells in `src/server/pages.ts`.
- Structured review, photographs, source display, and outcome controls.
- Pending-decision state for confirmation/corrections.
- Provider runtime schemas and active-question context.
- PostgreSQL migrations through `005_composite_fk.sql`.
- Regression and PostgreSQL integration tests.
- `scripts/browser-acceptance.mjs`.

`docs/evaluation.md` reports 51 automated tests and 24 real-Chrome checks passing. It identifies live Meta calls, full Compose/TLS boot, technician evaluation, and webhook reliability as remaining work. **Those reported results were not rerun while preparing this handoff.** Verify them against the checkout you actually receive. PGlite checks are useful PostgreSQL-engine tests; additionally verify the target containerized PostgreSQL deployment before making deployment claims.

`REVIEW.md` is a historical review of commit `63ecfc4`. Its original findings are not a statement that every issue remains open after the fixes. Preserve the fixes, verify relevant regressions, and record the actual remaining issues.

Important files:

| Area | Existing location |
|---|---|
| Turn processing, identification, handoffs | `src/domain/intake.ts` |
| Facts, questions, safety | `src/domain/facts.ts`, `questions.ts`, `safety.ts` |
| Document applicability and retrieval | `src/domain/knowledge.ts` |
| Live Meta requests and schemas | `src/integrations/meta/` |
| Seed/example knowledge | `src/content/seed.ts` |
| Persistence contracts and implementations | `src/db/store.ts`, `memory.ts`, `pg.ts` |
| Customer and staff APIs | `src/server/` |
| Customer and staff clients | `src/server/ui/` |
| Jobs and webhook delivery | `src/worker/` |
| Existing evaluation/runbooks | `docs/` |

Do not require a framework migration or backend rewrite for this upgrade. Inspect uncommitted changes and preserve other sessions' work. Check repository instructions and current branch/remotes before editing or publishing.

## 3. Why this upgrade matters

A general assistant can already ask appliance questions, inspect a label, consult supplied documents, and draft a summary. Agents can also perform integration work when given tools and permissions.

MendCue must show a practical advantage in the complete service workflow:

- Correctly identify the appliance and the documentation that applies.
- Ask follow-up questions that affect the technician's preparation.
- Preserve evidence and uncertainty instead of filling gaps with guesses.
- Deliver a brief that requires less human correction and follow-up.
- Let the technician confirm what is useful and record the actual outcome.

The main success criterion is **reduced human effort at an acceptable handoff quality**, measured on a small real pilot. Better-looking screens alone do not establish that advantage.

The public hackathon rubric weights impact 30%, Meta tooling 25%, technical execution 20%, and demo 25%. Use that as a prioritization guide, not as a prediction of winning. [Official event and terms](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver)

## 4. Runtime model requirement

The owner supplied this clarification from the hackathon Discord:

> Every model your project calls at runtime must be a Meta model.

The supplied clarification lists Muse Spark 1.3, Muse Voice Transcribe, SAM 3.1, Muse Image, and V-JEPA 2 as examples, regardless of how they are run. This Discord clarification was supplied by the owner; its authorship was not independently verified in this session.

Apply the Meta-only requirement to all runtime model use: conversation, vision/OCR performed by a model, classification, embeddings, reranking, speech, and fallback models. The current practical default is `muse-spark-1.3` through the Meta adapter. Check current API capabilities and account access before implementation.

Code-writing/review assistance is separate from the submitted application's runtime. The quoted rule does not require Muse to write the code. Another coding agent may perform this upgrade while preserving Meta-only runtime calls, subject to any other event rules.

Normal application rules, SQL, full-text search, and direct PDF text extraction do not require calling a model. Keep a model inventory so dependencies do not silently introduce another provider. The owner also supplied a Discord note saying that whether fitted linear regression counts requires an organizer ruling; do not treat that question as settled.

Development fixtures must remain visibly labeled. The submitted AI demonstration needs actual Meta inference for the capabilities it claims to demonstrate.

## 5. Scope and priorities

### Required for this upgrade

1. Verified appliance identity with an evidence trail.
2. A small, real, reviewed model-specific documentation collection.
3. Contextual, useful follow-up questions.
4. A clear technician brief with fact-level evidence and uncertainty.
5. A deliberate customer and technician interface built around those tasks.
6. A fair comparison against a well-prompted general Meta assistant.
7. Measured live-model behavior and an honest demonstration package.

Start with two focused case families: washer drainage/cycle interruption and refrigerator cooling complaints. Add dishwasher cases if the same evidence quality and end-to-end reliability can be achieved. Other appliances must retain general intake and human handoff.

Select approximately 3–6 real model examples based on available documentation and the technician's experience. These are a small starting target, not invented coverage. Prefer fewer well-supported examples to an unreviewed catalog.

### Preserve, with limited expansion

- Tenant isolation, branding, role/scope enforcement, API contracts, and embedding.
- Safe escalation and graceful model failure.
- The existing hosted pilot website.
- The existing second tenant as a demonstration of portability.

### Defer

- National appliance catalog completeness.
- Broad insurer-specific features and vendor-specific claims connectors.
- Phone calls, autonomous parts purchasing, and payments.
- Training a new diagnostic model.
- Additional model services without a clear demonstrated benefit.
- Enterprise billing, SSO, or infrastructure expansion beyond actual pilot requirements.

## 6. Appliance identity as a first-class artifact

The identity flow must distinguish observations, extraction, confirmation, and document matching.

Keep:

```text
Brand as printed and normalized brand identity
Raw model number and normalized lookup value
Serial number separately
Source attachment and relevant extracted text
Unresolved characters and alternative readings
Customer confirmation/correction event
Technician verification, when later available
Document applicability status
```

Required behavior:

- Use the vision provider's structured model and serial fields.
- Preserve suffixes and punctuation in the raw value.
- Ask about genuinely uncertain characters; do not declare every occurrence of 0, O, 1, or I unreadable.
- Accept an accessible label photo or manual entry. “Label inaccessible” remains a valid path.
- A longer serial number must never become the model number through a token-length heuristic.
- A customer's confirmation resolves transcription, not the physical cause of failure or document applicability.
- A brand/model correction invalidates dependent retrieval and the current draft assessment. Rebuild them without changing older submitted snapshots.

Customer UI: show the photo preview and editable extracted brand/model/serial fields together. Clearly distinguish “Please confirm,” “Confirmed by you,” and “Technician verified.” Avoid requesting another photo if the existing information is adequate.

## 7. Real documentation and applicability

The initial repository contains generic example playbooks, not a verified national manual collection. Keep them labeled as examples until an actual reviewer approves them.

Implement a small usable operator workflow:

1. Add an official manufacturer document or a locally supplied document with a recorded usage basis.
2. Preserve source URL, publisher, title, hash, and immutable version.
3. Extract text with PDF page boundaries.
4. Explicitly record the brands/models and sections to which it applies.
5. Review extraction and applicability before activation.
6. Publish the approved version; retain prior versions for existing handoffs.

A small administrative form or validated import command is sufficient. Do not build an unrestricted web crawler for this release. Fetching must use approved origins with bounded requests; customer-provided text and URLs must not trigger arbitrary server requests.

Source matching requirements:

- Exact model matching must account for brand/manufacturer when needed to prevent identifier collisions.
- A verified family relationship must come from documented applicability, not an inferred convenient prefix.
- A manual explicitly covering model A must not be reused for model B merely because its brand or appliance category matches.
- Generic category guidance must be explicitly identified as generic.
- Unconfirmed identifiers must not unlock exact-model claims.
- Separate exact-model, verified-family, category-only, and unknown status in the UI, even if internal types need a compatible migration.

An evidence reference should carry:

```typescript
type EvidenceReference = {
  documentId: string;
  documentVersion: string;
  documentHash: string;
  title: string;
  sourceUrl: string | null;
  pdfPageIndex: number | null;
  printedPageLabel: string | null;
  chunkId: string;
  excerpt: string;
  applicabilityBasis: string;
};
```

Use direct text extraction first. A scanned document that cannot be reliably extracted remains unavailable until a supported Meta vision path or human transcription/review is implemented. Keep originals and customer material in private storage, with appropriate access; do not commit them into the public code repository.

## 8. Follow-up questions that improve preparation

Question selection should target information the technician actually uses.

For each supported case family, prepare a small technician-reviewable question set containing:

```text
Question ID and version
Applicable case families/models
Fact collected
What service decision the answer affects
Expected answer shape and unknown option
Customer effort and safety constraints
Exclusions and stop conditions
Source or playbook reference
```

Examples of decisions include whether the complaint affects one or both compartments, when a machine stops, whether standing water remains, and which exact error text is visible. These are examples of observations to collect, not a model-specific interpretation of an error code.

The engine must:

- Extract answers already supplied in text or photographs.
- Interpret short replies in relation to the actual active question.
- Ask one useful question at a time.
- Avoid asking answered questions solely to complete a fixed script.
- Avoid repeating a question after an explicit unknown/skip answer.
- Respect category, version, hazard, and action preconditions in application code.
- Offer human handoff when further questions are unlikely to help.
- Collect contact/location through concise structured controls where that reduces effort.

Use an explicit decision table or a validated model selection from allowed question IDs. A newly trained question-ranking model is unnecessary. Store a short decision-oriented rationale for evaluation, such as “distinguishes one-compartment from whole-appliance cooling complaint.” Do not request or expose private chain-of-thought.

The technician should be able to identify questions that were unnecessary and facts that were still missing. Use that feedback to revise a versioned playbook through review.

## 9. Technician brief and human disposition

The brief is the primary output. A technician should understand the important facts in roughly one minute; measure that assumption.

Suggested order:

1. Appliance, brand/model, identification status, and documentation coverage.
2. Customer's complaint and timeline.
3. Safety status and any escalation.
4. Key observations, exact display/error text, and checks already attempted.
5. Preliminary issue areas, each with evidence and limitations.
6. Missing facts and the recommended human follow-up.
7. Customer contact, ZIP/location, and availability preference.
8. Photographs and sources.

Distinguish:

```text
Customer reported
Extracted from photo
Customer confirmed
Supported by an applicable document
AI hypothesis
Technician confirmed
Unknown / not collected
```

Every hypothesis must reference existing facts. Model-specific assertions require applicable source evidence. Verify the evidence supports the assertion, not merely that a citation ID exists. Unsupported hypotheses should be removed or reduced to a clearly limited general issue area. Do not invent probabilities, exact failed parts, compatible part numbers, or repair costs.

Provide a compact technician action panel:

- Ready to contact/plan visit.
- Need more information.
- Needs urgent human review.
- Edit brief.
- Record confirmed issue/outcome.

Keep the human disposition separate from conversation phase and workflow status. An AI-generated preliminary brief is ready for review; it becomes technician-approved only after a real staff action.

Capture correction history, missing facts, review time, and a short optional feedback note. Preserve immutable submitted handoff versions and their document versions.

## 10. Interface redesign requirements

Build on the current extracted UI modules. Keep the existing functional improvements and make the information hierarchy intentional.

### Customer intake

- Header with tenant identity and a restrained progress indicator: Appliance → Problem → Details → Review.
- A single conversational focal area, with appliance choices and relevant quick replies.
- A useful identity card showing the label photo and extracted fields.
- Desktop summary panel; mobile expandable “Details collected.”
- One primary composer action, with secondary attachment/human actions visually quieter.
- Clear upload, model-processing, retry, and saved-state feedback.
- A real editable review screen and one final send action.
- Confirmation showing the case reference and the actual next step configured for the business.
- Persistent, appropriate emergency state when relevant.

### Technician workspace

- Clear organization identity, navigation, and meaningful inbox filters.
- Readable case rows/cards with appliance, complaint, location, human-readable status, and age.
- A dominant service brief with supporting evidence available nearby.
- A source drawer/viewer that opens the relevant excerpt and real document/page metadata.
- Photo enlargement with authenticated access.
- A compact approve/request-details action area.
- Transcript, audit trail, and raw export as secondary views.
- Stable case URLs or navigation state so the technician can return to a case.

Replace raw field names such as `drain_observation` with clear labels. Never hardcode an “exact model” or “ready” badge independently of actual stored state. Distinguish hypothetical issue areas from confirmed repair findings visually and in wording.

### Hosted business website

Keep it small: real tenant identity, a clear request-service action, service categories/area, short process explanation, and a direct contact alternative. Retain visible demo labeling until real details are provided. Use MendCue branding on the product/technical demonstration surface and tenant branding on the repair business's customer surface.

### Visual and accessibility targets

- Use the existing neutral/teal direction consistently, with stronger typography, spacing, and hierarchy.
- Use warning and emergency colors for meaningful state.
- Fit the customer interface at 320–390 CSS pixels without horizontal overflow.
- Verify desktop at approximately 1440 × 900 and phone at approximately 390 × 844.
- Provide visible keyboard focus, labels, logical tab order, and appropriately announced asynchronous status.
- Preserve reduced-motion behavior and readable zoom/reflow.
- Keep internal technical diagnostics out of customer copy.
- Render verified empty/error states instead of fabricated healthy dashboards or statistics.

Capture before/after screenshots from actual rendered pages with synthetic data. No screenshot or prototype should be presented as working functionality unless its underlying interaction works.

## 11. Live Meta verification and operating limits

Before judging diagnostic quality, verify the actual API path.

Implement or confirm:

- Text and label-image requests against the configured Meta model.
- Runtime schema validation and refusal/timeout/failure handling.
- Bounded prompt history and retrieved context.
- Safe request diagnostics without secrets or customer transcripts in ordinary logs.
- Input/output token usage when returned, latency, model ID, and prompt/schema versions.
- Per-case limits, a global spending limit, and concurrency/rate controls.
- A clear distinction between configured live mode and a successful live response.

Store price assumptions as configuration with an effective date. If the provider does not report usage for a failed request, record it as unknown rather than zero cost. Separate measured usage, estimated cost, and any actual provider billing information.

Use an existing valid server-side key if available and operate within the owner's configured budget. If no budget is configured, prepare a bounded smoke test and default its maximum allowed spend to USD 2; do not run an unbounded evaluation. Full comparison runs must have an explicit configured cap. Stop new model requests when the cap or usage uncertainty makes further spending unsafe to estimate.

If a key or live access is unavailable, continue useful implementation, fixtures, browser tests, and evaluation preparation. Mark live results unverified; never fabricate latency, accuracy, costs, or successful calls.

## 12. Fair comparison with a general assistant

Create a reproducible benchmark using a **well-prompted Meta assistant baseline**, not deliberately weak prompts or a different quality model.

Both systems must use the same Meta model/version for a paired run, equivalent source documents and images, comparable output budgets, and the same initial customer information. Differences in workflow/context delivery are part of the product, but document them. Do not give MendCue the completed diagnosis as input or hide applicable manuals from the baseline.

Version the baseline prompt. It should ask for sensible follow-up questions, uncertainty, safety escalation, and a concise technician handoff. Do not intentionally omit these from the baseline.

Run two distinct comparisons:

### A. Identical-input brief quality

Give both systems the same recorded intake facts/transcript, photos, and available documentation. Compare the resulting briefs. This isolates extraction, grounding, presentation, and human correction burden.

### B. End-to-end intake effort

Start with the same initial complaint. Use a predefined source case record and a technician/operator who answers only information that was actually known or observable. Each system may ask its own questions. Record the question count, duplicated/unnecessary questions, customer effort, and final missing facts.

Do not claim to compare adaptive questioning by replaying a single fixed transcript that only one system generated. Avoid model-generated customer replies that silently invent evidence; a simulated case must have a fixed truth record and remain labeled synthetic.

The baseline can be a standalone evaluation harness; it need not be an end-user production feature. Protect it from public unbounded model use.

## 13. Case collection and technician grading

Target 5–10 anonymized past jobs from the Phoenix technician as an initial pilot dataset. The technician should supply or verify the initial complaint, what the customer actually knew, relevant photos/documents, and eventual confirmed findings where available.

The confirmed repair outcome is held separately from model inputs. A suspected issue is not ground truth merely because an AI generated it. A completed repair can still have an uncertain cause; label uncertainty honestly.

If real jobs are unavailable, build a clearly labeled synthetic development set and the collection/grading interface. Record that real pilot evidence is pending. Do not claim business savings from synthetic cases.

For each case, the technician defines the important intake facts before seeing generated outputs. Include unknown-model, inaccessible-label, ambiguous-character, wrong-manual, and hazard cases in separate regression scenarios.

Randomize the display order of comparison outputs and conceal system identity during quality grading. Preserve the actual text and model/prompt versions for the run. Blind grading improves the signal; it does not make a small sample statistically representative.

Use the existing four handoff grades:

```text
Useful as received
Useful after minor corrections
Needed substantial follow-up
Misleading or unusable
```

Also collect:

- Facts the technician still needs.
- Incorrect or unsupported assertions.
- Whether exact appliance identification is correct.
- Whether cited documentation actually applies.
- Active review/edit time.
- Extra follow-up questions or callback required.
- Final technician-approved brief, if produced.

## 14. Metrics and reporting

Keep denominators and units explicit.

| Metric | Definition |
|---|---|
| Critical-fact completeness | Known applicable critical facts correctly captured / known applicable critical facts expected for that case |
| Unknown handling | Whether unavailable facts remain explicitly unknown without invented values |
| Identification quality | Correct confirmed brand/model, incorrect confirmation, or appropriately unresolved |
| Grounding quality | Applicable sources and supported assertions; count unsupported model-specific claims separately |
| Follow-up burden | Additional facts/questions the technician needs after reading the brief |
| Human preparation time | Measured active review, correction, and follow-up time; include manual work required by either system |
| Customer effort | Intake turns, elapsed/active time when measurable, repeated questions, and abandonment |
| Operational completion | A submitted brief arrives in the intended staff workflow and can be reviewed |
| AI operation | Actual latency, usage, estimated cost, failures, and mode/model version |

Do not count a required-but-unknown fact as correctly discovered. Report it as a separate missing/unknown outcome. If a case does not have an applicable model-specific source, exclude it from a model-specific grounding denominator and report that exclusion.

Timing controls should support pause/resume or explicit manual duration entry. Record whether a value is automatically measured, manually entered, or estimated. Use comparable tasks and conditions across systems; randomize order where learning the same case could affect timing.

Show per-case paired results and aggregate summaries, with sample size and missing measurements. A 5–10-case exercise is pilot evidence, not proof of national diagnostic accuracy or guaranteed time savings. If the baseline is better, show it and investigate why.

Do not publish unsupported improvement percentages, population-wide claims, or selected best-case results as representative outcomes.

## 15. Suggested data and code additions

Extend existing contracts and migrations rather than maintaining a disconnected demonstration backend.

Likely domain additions:

```text
ApplianceIdentityEvidence
DocumentApplicability / versioned evidence references
QuestionDecisionEvent
TechnicianDisposition
BriefRevision / correction records
EvaluationCase and withheld outcome
EvaluationRun and paired system outputs
TechnicianGrade
ReviewTimingMeasurement
ModelUsageRecord
```

Keep evaluation case truth/outcomes unavailable to runtime intake/assessment prompts. Evaluation data is tenant-scoped and private unless deliberately exported as anonymized or synthetic demonstration material.

Possible structure, adapting to the actual repository:

```text
src/domain/identity.ts
src/domain/brief.ts
src/domain/evaluation.ts
src/integrations/meta/usage.ts
scripts/import-knowledge.mjs
scripts/run-comparison.mjs
docs/pilot-case-template.md
docs/baseline-prompt.md
docs/benchmark-method.md
docs/verification-latest.md
```

These filenames are suggestions. Follow existing conventions where they reduce duplication. Update both memory and PostgreSQL store implementations, permissions, migrations, and API documentation when adding persisted behavior.

## 16. Delivery sequence and timebox

The submission deadline previously verified is November 4, 2026, at 9 p.m. Eastern: November 5 at 7 a.m. Tashkent / November 4 at 7 p.m. Phoenix. Recheck the official portal for changes and required submission materials.

| Order | Deliverable | Suggested effort cap |
|---|---|---|
| 0 | Inspect checkout, rerun baseline checks, document actual remaining blockers | 2 hours |
| 1 | Real model identity and documentation/evidence flow for a narrow case set | 6–8 hours |
| 2 | Useful questioning and technician brief with corrections/disposition | 6–8 hours |
| 3 | Focused customer/staff UI refinement and actual browser verification | 6–8 hours |
| 4 | Fair baseline harness, grading/timing, live smoke tests under a cap | 4–6 hours |
| 5 | Technician comparison, fixes, demonstration, and honest result summary | 4–6 hours plus technician availability |

These are planning caps, not guaranteed estimates. Work with the remaining time visible in the new session. Pursue documentation/case collection alongside implementation when possible; do not wait idle for external inputs while independent work remains.

If time becomes short, cut extra models/manuals, animations, additional settings, and comparison dashboards first. A simple versioned JSON/CSV report is sufficient. Preserve reliable intake, safe escalation, source applicability, readable handoff, and evidence of what actually worked.

Keep R13 webhook/outbox and any R14 operating controls explicit in the remaining-work list. Complete the controls required by actual live traffic and the demonstration's claims; do not silently declare the entire historical review closed.

## 17. Acceptance criteria

### Product and evidence

- A real label photo or manual entry creates a confirmable identity with provenance.
- Serial numbers cannot displace models; corrections invalidate dependent draft analysis.
- A similar-looking unsupported model cannot inherit another model's exact manual.
- Each model-specific assertion links to an applicable immutable document version and actual page/excerpt.
- Uncertainty and unavailable documentation lead to an honest useful handoff.
- Questioning uses existing answers and collects information the technician considers relevant.
- The technician can review, correct, and approve a readable brief and record what was missing.

### Operation and interface

- Hosted and genuine cross-origin intake work.
- Refresh, retry, queued replies, and photograph processing preserve the case.
- Review/edit/final-submit is explicit and idempotent.
- Emergency reports interrupt every message path, including confirmation and pending decisions.
- Tenant boundaries, staff roles, and service-key scopes remain enforced.
- Private photographs and knowledge remain accessible only to authorized participants.
- The customer and staff flows are usable at phone and desktop sizes and by keyboard.
- Runtime model providers are Meta-only; fixtures and unknown live status remain labeled.

### Evaluation

- Baseline and MendCue runs are versioned, comparable, and reproducible.
- Ground truth is excluded from prompts and grading order is randomized.
- Raw paired results and actual human grading/timing can be exported.
- Reports identify real versus synthetic cases and measured versus estimated values.
- No positive business-impact claim is generated automatically from fixtures or invented data.

## 18. Verification and demonstration package

Run appropriate checks after changes:

```bash
npm test
npm run typecheck
npm run build
node scripts/browser-acceptance.mjs
```

Inspect browser prerequisites first; the existing script expects an actual Chrome/headless-shell binary via `CHROME_BIN` when needed. Add meaningful regressions for the new identity, applicability, and grading behavior. Run target PostgreSQL/container checks and limited live Meta smoke tests when available. Report missing dependencies/access accurately.

Capture a concise verification record: commit, commands, environment, provider/mode, case set, results, and unverified items. Keep credentials and private inputs out of the record.

Prepare a short demonstration, adjusting length to the portal's actual requirement:

1. State the technician's real intake/preparation problem.
2. Show a customer describing a problem and uploading a real or clearly labeled synthetic label photo.
3. Show model confirmation and applicable documentation.
4. Show one follow-up question materially improving the brief.
5. Show the submitted brief, evidence, and technician decision.
6. Show actual paired pilot results if available, with sample size.
7. Briefly show the same platform embedded for a second tenant.
8. State the limitations and the specific role of Meta inference.

Choose a documented case for which the capabilities actually work. Do not hide mock responses inside a supposedly live flow. An honest unknown/ambiguous case can demonstrate value when it prevents a wrong model-specific claim.

## 19. Completion handoff

The next session should leave:

- Working implementation and relevant migrations/contracts.
- The focused customer and technician interfaces.
- A small verified document set or an explicit list of unavailable sources/reviews.
- A versioned baseline prompt and comparison runner.
- Case collection and grading templates/interfaces.
- Exportable paired results when real runs were possible.
- Before/after screenshots from actual browser rendering.
- A verification report and remaining-work list.
- A concise demo script and submission description using only supported claims.

Missing real cases, technician approval, a Meta key, or deployment access must remain visible limitations. Continue all useful independent work, then distinguish implemented, executed, and externally blocked tasks.

## 20. Copyable instruction for the next coding session

> Continue MendCue in `/home/zemmli/appliance-intake`. Read NEXT_UPGRADE.md, repository instructions, DESIGN.md, and current verification notes. Inspect the checkout and preserve existing work. REVIEW.md describes an older version; verify which findings are already fixed before changing code.
>
> Execute NEXT_UPGRADE.md in priority order. Focus on a technician-approved service brief: reliable label identity, exact-model document applicability, useful follow-up questions, evidence-linked uncertainty, and a clear customer/technician interface. Keep the shared tenant-aware API/widget architecture and Meta-only runtime model requirement.
>
> Build a fair comparison with a well-prompted general Meta assistant using equivalent facts, photos, documentation, and model versions. Support real technician grading and measured review/follow-up effort. Separate fixed-input quality comparison from adaptive intake comparison. Preserve raw results and report limitations; never invent pilot outcomes or savings.
>
> Verify meaningful regressions, the actual browser flows, and database behavior. Use existing server-side credentials only within configured live-run budgets. If real cases, a key, reviewer input, or deployment access are missing, continue independent implementation and record exactly what remains unverified.
>
> Deliver working changes, evaluation tooling, screenshots, verification notes, remaining work, and an honest demonstration package. Follow existing repository publishing instructions and preserve remote work; do not force-push or overwrite unrelated changes.
