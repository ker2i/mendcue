# MendCue — next implementation session

Prepared October 30, 2026 against commit `e1e94ac` in
`/home/zemmli/appliance-intake` (`ker2i/mendcue`).

## Objective and division of work

The owner is arranging the domain and the real repairman's website. Work on the
application, reliability, and evaluation tools while that proceeds. Prepare the
existing product for a small supervised pilot and a convincing hackathon demo:

> Customer report and label → confirmed appliance identity → useful follow-up →
> durable service brief → technician notification, review, and correction.

Keep the Express/TypeScript, PostgreSQL, worker, tenant, and embed architecture.
Do not require a framework rewrite, another website, or additional infrastructure
to begin. Domain registration, DNS, and building the repairman's website are outside
this brief. Prepare a documented integration path for that site using the existing
hosted intake or widget; real branding and origins can be supplied later.

Read `NEXT_UPGRADE.md` for the original product requirements, then this file for
the updated implementation order. Preserve identity provenance, safety escalation,
tenant isolation, restricted database roles, private photos, CSRF, and human approval.
Runtime model calls must remain Meta-only, including any model-based OCR or fallback.

## First: inspect and verify the checkout

1. Check applicable `AGENTS.md` instructions, branch, history, and working-tree diff.
   No repository `AGENTS.md` was found when preparing this file; check again.
2. Read `docs/verification-latest.md`, `docs/deployment.md`,
   `docs/model-inventory.md`, `docs/benchmark-method.md`, and
   `docs/demo-site-verification.md`. Older checkpoint wording is historical:
   `e1e94ac` was subsequently pushed to `origin/main` in the prior session.
3. Preserve the uncommitted static demo work: modified `README.md` and
   `package.json`, plus `.github/`, `demo-site/`, demo scripts, verification notes,
   and screenshots. Do not reset, discard, or accidentally publish it.
4. Run the existing checks before edits and record the actual results. Previously
   reported: 64 application tests (including seven PGlite tests), 28 product browser
   checks, and 22 static demo browser checks passed. Those suites were **not rerun
   while writing this brief**. Typecheck/build also previously passed.

```bash
npm test
npm run typecheck
npm run build
node scripts/browser-acceptance.mjs
npm run demo:test
```

Browser scripts require Chrome; set `CHROME_BIN` if the default executable is
unavailable. Inspect inherited environment so fixture checks cannot contact a real
provider or production database. Build before the product browser script.

## What is already implemented

- Separate brand/model/serial fields, editable identity and confirmation, stale
  draft assessment invalidation, and immutable submitted brief snapshots.
- Brand-bound exact model and explicitly enumerated family applicability; four
  coverage states and immutable source/version/page/excerpt metadata.
- Local PDF prepare/review/publish CLI with usage-basis metadata; migration 006.
- Conservative generic issue areas; unrestricted diagnostic claims are withheld.
- Append-only technician review events with corrections, missing facts, and manually
  supplied review seconds; staff review UI and private photo/excerpt display.
- Meta request/schema/output bounds and a shared-file estimated usage ledger with
  lifetime/per-case caps and a stop on unknown usage. These are single-host controls.
- Private, blinded, **text-only raw-assessment** comparison runner and grade exporter.
- A separate modern static demo with scripted synthetic scenarios. It is not the
  live product and does not establish Meta inference or pilot results.

No live Meta call, reviewed real manual import, real technician pilot, full target
Compose/TLS deployment, or backup restore has been demonstrated. No measured
accuracy, time savings, or successful live-image result may be claimed yet.

## Implementation order

### 1. Unify configuration and fail clearly in production

**Observed:** `src/server/index.ts` selects live mode when a key exists even without
`MODEL_PROVIDER=live`; `src/worker/index.ts` requires explicit live mode and a key.
Both silently create separate seeded in-memory stores without `DATABASE_URL`.

Implement shared, validated configuration/provider construction for web and worker.
Production must require persistent storage and valid explicit provider settings;
missing live credentials must fail startup rather than select fixtures. Keep an
explicitly labeled fixture mode for tests/development and intentional demo use.
Validate required production secrets and media configuration without logging values.
Update `.env.example`, Compose, and deployment instructions together.

Acceptance: a configuration matrix covers absent/invalid mode, missing live key,
fixture mode with a key, and missing production database. Web and worker agree;
test/local fixtures stay usable; readiness never represents memory as durable SQL.

### 2. Finish durable submission, outbox, and scheduled retries (R13)

**Observed:** `submitCase` writes the handoff, case, event, and webhook job separately.
`deliverWebhooks` creates a new event ID on each attempt and can resend successful
endpoints when a later endpoint fails. `failJob(retryAt)` discards the timestamp in
both stores; PostgreSQL's helper accepts only a retry boolean.

Locations: `src/domain/intake.ts`, `src/worker/worker.ts`,
`src/integrations/webhooks/sign.ts`, `src/db/{store,memory,pg}.ts`, and
`migrations/004_auth_paths.sql`. Add a new migration; preserve deployed history and
the restricted role/RLS design. Include status-change event producers in the audit.

- Commit submitted snapshot, case transition, audit event, and outbox work atomically.
  Concurrent/repeated submission must preserve the intended handoff version and
  idempotency behavior rather than creating duplicate logical submissions.
- Persist logical event ID, timestamp, payload, and endpoint delivery progress.
  Reattempts retain event identity/payload; signature timestamps may change.
- Persist an availability timestamp and honor it when leasing, including after
  worker restart. Retain attempt limits, recover expired leases, and preserve
  per-case ordering. Check that deferred work cannot exhaust attempts in a tight loop.
- Keep delivery at least once. Receiver deduplication must be possible; a receiver
  accepting a request just before a crash can still see the same event again.
- Give failed work a visible state and a bounded operator retry path.

Acceptance: fault injection proves submission rollback leaves no partial handoff;
concurrent submissions are consistent; jobs cannot lease before their due time;
restart preserves retry timing/event identity; one successful endpoint is not
needlessly replayed because another fails; cross-tenant access remains denied.
Exercise memory parity, SQL integration, and actual container PostgreSQL when available.

### 3. Make ordinary label photos usable within bounded Meta requests

**Observed:** `processLabelPhoto` base64-encodes the stored upload directly, while
`postChat` rejects serialized requests above 120,000 bytes. Ordinary phone photos
can therefore upload successfully and still fail model processing. Live images
also require `META_IMAGE_BILLING_REVIEWED=1`.

Add bounded server-side decoding, orientation correction, metadata removal, and
resize/compression for a private inference derivative. Bound pixel count and
processing resources as well as bytes. Preserve attachment provenance and never
replace the image with an unreadable thumbnail just to fit the ceiling. Keep text
and image budgets explicit; if the image ceiling changes, update reservations and
document the reviewed basis. Do not simply raise limits without spend controls.

Locations: `src/server/app.ts`, `src/domain/intake.ts`,
`src/integrations/storage/storage.ts`, `src/integrations/meta/{meta,usage}.ts`.
Keep manual entry, inaccessible-label, uncertainty, and confirmation paths usable.

Acceptance: representative permitted JPEG/PNG/WebP uploads, rotated photos, malformed
files, excessive dimensions, and unreadable labels behave predictably. Originals
and derivatives remain private and metadata policy is explicit. Local checks prove
bounded requests; only an actual successful Meta request proves live readability.

### 4. Provision the real technician and deliver an actionable notification

Add a private operator CLI for tenant/staff provisioning and password rotation using
existing tenant contracts, `saveStaffUser`, and salted password hashing. Separate
real provisioning from demo seeding. Do not introduce public signup for this pilot.
Accept actual business/contact/service-area/origin settings when supplied; validate
configuration and avoid command-line plaintext password exposure or secret logging.

Implement one practical notification channel, preferably email through an existing
owner-selected service or SMTP account. Current `notifications.emailEnabled/emailTo`
are configuration fields, not proof of delivery. Build on durable outbox work.
Use an authenticated staff link and case reference; keep customer photos, transcripts,
and service credentials out of the notification. Show pending/failed delivery and
support retry. If credentials are absent, verify with a local test receiver and
leave real delivery explicitly unverified; continue other work.

Acceptance: a tenant can be provisioned without demo credentials; the technician
logs in and sees only that tenant; one submission produces recoverable notification
work; review/correction persists after reload. Document password reset/rotation and
the hosted URL/embed snippet needed by the separately built website.

### 5. Prepare and verify the VPS runtime and data lifecycle

Use the existing Compose layout. Verify migrations, restricted runtime role credentials,
persistent SQL/media/shared usage ledger, outbound provider access, queued turns,
and both processes reading the same configuration. Improve readiness/worker health
so a live process is distinguishable from a worker actually making progress; health
checks must not issue paid inference requests or disclose credentials/internal errors.

Add privacy-safe operational diagnostics for failed jobs and provider outcomes,
including latency, reported usage, estimated cost, and unknown usage. Preserve the
stop on uncertain billing and document bounded manual reconciliation after a crash;
never auto-delete a stale usage lock to resume spending. Public traffic still needs
reviewed account billing limits and a deliberately configured cap.

Implement scheduled retention/deletion using existing tenant retention settings.
Cover attachments/derivatives, sessions, relational dependencies, and private operator
artifacts; preserve accounting integrity and document backup expiry separately.
Add storage deletion support with validated paths and idempotent retries as needed.
Correct and rehearse the backup/restore procedure against the actual Compose volumes.

Acceptance: a queued customer case survives web/worker restart, reaches the staff
inbox with private photos, and can be restored from SQL plus media backup. Retention
does not delete another tenant's data or active cases. Report local container tests
separately from VPS/TLS checks. Earlier PostgreSQL image download stalled; do not
substitute PGlite results for an unexecuted deployment check.

### 6. Finish evidence and technician evaluation support

- Keep the existing manual import workflow. Validate real PDF extraction with
  `pdftotext`, draft/review/publish separation, page mapping, usage basis, and exact
  model/family applicability. Real manuals and approval come from the technician;
  synthetic documents can test mechanics but cannot establish actual coverage.
- Add a distinct technician identity-verification control with actor/time/provenance.
  It must not be conflated with customer confirmation or mutate submitted snapshots.
- Add a pause/resume active review timer and persist actual correction/missing-fact
  feedback. Keep timer measurements distinct from manually supplied seconds and
  elapsed wall-clock time. Review events must remain append-only and tenant-scoped.
- Extend `scripts/run-comparison.mjs` beyond raw text-only assessments to compare
  complete product briefs and equivalent image inputs. Reuse real brief generation;
  do not create a demonstration-only handoff implementation. Give both systems the
  same model, known facts, reviewed documents, images, and comparable output budgets.
- Preserve randomized blinded grading, raw outputs, version hashes, partial failures,
  and explicit spend caps. Keep eventual repair outcomes out of runtime inputs.
  Adaptive questioning remains a separate operator-recorded experiment unless its
  own controlled runner is implemented. Never infer adaptive benefits from fixed input.
- Extend private artifact exports for measured review effort, missing critical facts,
  unsupported claims, latency/usage, and sample counts. Private files remain adequate
  for this pilot; database evaluation APIs are lower priority than trustworthy results.

Acceptance: synthetic end-to-end evaluation proves mechanics without implying pilot
results. The technician can later grade 5–10 anonymized past jobs using
`docs/pilot-case-template.md`; no real job, grade, outcome, or savings is fabricated.

### 7. Final product polish and submission readiness

After reliability, improve the actual intake/staff experience where needed: explicit
upload/queued/failed/retry states, reload continuity, keyboard use, 320px reflow,
zoom, and staff phone usability. Reuse the established visual direction where it
helps; keep the separate static demo honestly labeled.

Prepare a sanitized demonstration dataset and a reproducible reset procedure, an
end-to-end smoke checklist, current architecture/model inventory, and an honest
demo script distinguishing live inference from fixtures. Record supported evidence
and remaining limits. Actual business details, reviewed manuals, live keys, technician
participation, and submission-portal requirements are external inputs, not reasons
to stop independent code work or invent substitutes.

## Scope boundaries and completion report

Prioritize 1–3 first, then provisioning/notification and operational checks, then
evaluation support. Build and verify each coherent increment before broadening scope.
Defer broad appliance catalogs, payments, autonomous diagnosis/parts purchasing,
additional runtime model providers, multi-host budgeting, and enterprise features.
Keep conservative issue-area output until supported assertion validation is real.

For each code increment, add meaningful regression coverage for behavior and failure
boundaries, update both stores and migrations when needed, and run the relevant tests,
typecheck/build, and browser checks. Keep credentials and real customer material out
of source control. Do not spend on live calls without an available server-side key
and configured bounded budget. If external inputs are unavailable, finish the code
and local verification and name the precise unexecuted acceptance checks.

Update verification/runbooks with what changed, exact commands/results, schema/env
changes, evidence produced, and remaining blockers. Preserve unrelated work. This
brief does not itself request a commit, push, DNS change, or production deployment.

## Copyable prompt for another session

> Read NEXT_IMPLEMENTATION.md and NEXT_UPGRADE.md in /home/zemmli/appliance-intake.
> Start by inspecting the checkout and verifying existing work. Implement the code
> priorities in NEXT_IMPLEMENTATION.md, starting with shared production/provider
> configuration, durable submission/outbox/retries, and bounded usable label images.
> Preserve uncommitted demo-site work. I am arranging the domain and the repairman's
> website separately. Continue useful implementation when live credentials, manuals,
> or technician cases are unavailable; report those checks as unverified. Keep runtime
> inference Meta-only, retain safety/tenant/privacy controls, and never invent results.
