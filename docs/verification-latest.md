# Implementation verification — October 31, 2026

Base: `33ed033`, branch `main`. Continued the implementation brief with browser,
operator PDF and migration recovery verification. Original static demo work remains
uncommitted; its local browser harness received portability changes only. No DNS,
production deployment, live Meta inference, real mail or customer material was used.

## Changes in this increment

- Staff timer controls update in place after automatic background pauses and manual
  start/pause, preserving unsaved corrections, missing facts and identity fields.
  Concurrent pause triggers share one request; leaving for another case waits for
  the pause, and opening Settings pauses review. Timer failures remain visible.
- Identity verification returns the new case version and updates the visible status
  without clearing a review draft. Timer mutations reject stale case versions.
  Saved correction/missing-fact/unsupported-assertion/note fields refill on reload.
  Read-only users have disabled timer/verification actions. Identity controls reflow
  on phones, and returning from Settings restores the desktop inbox grid.
- Shared browser launcher discovers Linux Chrome or Windows Chrome through WSL,
  retains `CHROME_BIN`, and uses an isolated Windows profile with path translation
  for local upload/download checks. Fixture browser startup failure cleans up its
  servers. Screenshots use foreground pages to avoid background capture stalls.
- Each migration's DDL and migration record now commit in one transaction using
  one acquired connection. Injected failure after migration 007's DDL proves full
  rollback, safe retry and a subsequent no-op migration run. Historical SQL files
  remain unchanged; no new schema or environment settings are needed.
- New `scripts/knowledge-acceptance.mjs` exercises the actual local PDF CLI using
  a generated two-page synthetic PDF. Optional dedicated test SQL verifies publish,
  selected-page citations, exact-model applicability and tenant isolation.

## Executed checks

- `npm test`: **101 passed, one container-only test skipped**, across 17 files.
  `npm run typecheck`, `npm run build`, JS syntax and `git diff --check`: passed.
- `node scripts/browser-acceptance.mjs`: **41/41 passed**, using installed Windows
  Chrome 156 through WSL. Includes background pause/resume, keyboard activation,
  Settings pause, draft preservation, reload persistence, immutable submitted
  snapshots, private photos, tenant embeds, 320px intake/staff and a 640px reflow
  equivalent to 200% on a 1280px display. This is not a physical-device or browser
  UI zoom audit. The queued-memory check proves client polling, not a shared worker.
- `SCREENSHOT_DIR=/tmp/mendcue-demo-oct31 npm run demo:test`: **22/22 passed**.
  Static screenshots stayed outside the repository; the existing demo screenshots
  were preserved. No static-site publication was performed.
- Fresh actual `postgres:16-alpine` container: built migration CLI applied all eight
  migrations. `TEST_POSTGRES_URL=<dedicated local URL>/mendcue_test npm test -- tests/pg.integration.test.ts`:
  **12/12 passed** with the restricted runtime role. A temporary localhost relay to
  the container bridge supported WSL connectivity. No production SQL was contacted.
- Poppler 24.02 from user-local extracted Ubuntu packages:
  `node scripts/knowledge-acceptance.mjs` **5/5 passed** without SQL. With the
  dedicated container URL using `app_runtime`, **6/6 passed**, including actual CLI
  publication. Checks cover original bytes/hash, page indexes/labels, private file
  permissions, cleared approval flags, rejected unreviewed/unselected/tampered
  input, retained usage basis and tenant/model boundaries. All source text and
  review fields are explicit scripted fixtures, not real human manual approval.
- Refreshed synthetic product screenshots inspected at `/tmp/mendcue-staff.png`
  and `/tmp/mendcue-staff-review-phone.png`; generated images were not committed.

## Remaining external verification

Full Compose build/boot and Compose-volume restore remain unexecuted. Node 20
Alpine pulls failed from Docker Hub (connection refused) and the public ECR mirror
(repeated downloads ending in EOF). The successful PostgreSQL container checks do
not establish a full deployment or backup rehearsal.

VPS/Caddy/TLS, actual business configuration and website origins, SMTP inbox receipt,
reviewed real manuals, capped live Meta text/images/complete briefs, and real
technician cases/grades/effort/outcomes remain unverified. The earlier separate-process
SQL restart and dump/restore smoke below is historical local evidence. Synthetic
fixtures establish mechanics, not accuracy, readability or time savings.

---

# Previous implementation verification — October 30, 2026

Base: `e1e94ac`, branch `main`. No repository AGENTS.md was found. The original
static-demo working tree was preserved and excluded from this implementation commit.
No production deployment, DNS change, live inference or real customer traffic was used.

## Executed baseline

- `npm test`: 64/64 passed (including seven PGlite tests).
- `npm run typecheck` and `npm run build`: passed.
- Product browser script and `npm run demo:test`: could not launch; configured Chrome
  executable is absent. Cached browser archives are incomplete and a bounded fresh
  download did not finish. The older browser pass counts below are historical.

## Changes

- Shared explicit fixture/live validation and construction for web/worker. Production
  requires persistent PostgreSQL, HTTPS origin, real secrets and persistent media/ledger
  paths; no implicit key-based live mode or production memory fallback. Readiness labels
  memory as non-durable and redacts internal errors. Compose/env/runbook agree.
- Atomic submitted assessment/snapshot/case/audit/outbox and atomic staff status events.
  Concurrent/repeated submissions retain one logical handoff. Stable logical webhook
  event/payload and exact signed bytes, persisted endpoint progress, due times, ordered
  channel queues, lease generations, expiry recovery, bounded attempts and three staff
  retry batches. At-least-once semantics are explicit; no exactly-once claim.
- Native bounded JPEG/PNG/WebP decoding, orientation, metadata removal and full-size
  private normalization. Original-upload hash plus stored-image hash preserve provenance.
  In-memory vision JPEG is capped at 75KB within the unchanged 120KB serialized request
  ceiling/reservation. Dense/unprocessable images use manual entry/crop guidance.
- Private validated tenant/staff provisioning and salted-password rotation via stdin;
  rotation revokes existing sessions. Durable SMTP work contains only a case reference
  and authenticated staff URL. Delivery/job states and bounded retry appear in Settings.
- Poll-cycle worker health, private model diagnostic export, scheduled tenant-scoped SQL
  retention and retryable media deletion, recognized private-export retention, and
  Compose-volume-aware backup/restore scripts. Usage accounting is never reset by retention.
- Separate append-only technician identity verification and actor-scoped pause/resume
  review intervals. Timer-derived review seconds are server-derived and distinct from
  manual entries; submitted snapshots remain unchanged. Browser crashes still require
  operator review of any unpaused interval before treating it as active effort.
- Complete-brief fixed-input comparison through real submission, equivalent facts,
  reviewed sources and image derivative, an independent general Meta brief, randomized
  order/A-B artifacts, source/prompt hashes, raw responses, usage, latency and partial
  failures. Old text-assessment runner remains separate. Outcome fact keys are rejected.
  Adaptive interviewing is still an operator-recorded experiment.
- Updated deployment, pilot smoke checklist, tenant template and grading exports.

Schema: new migrations **007_durable_outbox.sql** and **008_image_provenance.sql**;
historical migrations untouched. New runtime dependencies: Sharp/libvips and Nodemailer.
New optional SMTP and private-export-root settings are in `.env.example`; production
configuration is stricter and must be filled before launch. Deploy schema and application
with both callers stopped; old worker helper signatures are incompatible.

## Final executed checks

- `npm test`: **100 passed, one container-only test skipped**; includes 11 PGlite
  tests and synthetic mocked Meta/image, SMTP, provisioning, timer, retention,
  rollback, retry, endpoint-progress and input-equivalence regressions.
- `npm run typecheck`, `npm run build`, `git diff --check`: passed.
- JS CLI/client syntax checks and `bash -n scripts/backup.sh scripts/restore.sh`: passed.
- `docker pull postgres:16-alpine` eventually completed. The same SQL suite ran against
  a dedicated local container using actual `app_runtime` credentials: **12/12 passed**,
  including concurrent submissions, rollback, UUID endpoint progress and scoped retention.
  Command: `TEST_POSTGRES_URL=<dedicated local owner URL>/mendcue_test npm test -- tests/pg.integration.test.ts`.
  WSL host-port forwarding was unavailable; a temporary localhost TCP relay to the
  container bridge supported the test. No production database was contacted.
- Actual separate web/worker processes, fixture mode, shared container SQL and temporary
  private media: created a case/photo/three queued turns, restarted PostgreSQL and web,
  started worker, observed one handoff, authenticated staff photo access, anonymous photo
  denial, and review persistence after reload. This is synthetic local runtime evidence.
- `pg_dump -Fc`/`pg_restore --no-owner` into a second isolated container database, with a
  separate temporary media tar/extract: restricted-role case lookup and restored attachment
  SHA-256 checks passed. This is not a full Compose/VPS volume/TLS rehearsal.
- Local SMTP receiver accepted the stable Message-ID/reference/staff link. No real mail
  account or technician inbox was exercised.
- Both browser commands were retried and still fail before browser launch because Chrome
  is missing. No fresh visual/accessibility/screenshots claim is made.

## Precise outstanding evidence and work

- Full target Compose build/boot, actual Compose-volume restore, Caddy/TLS/VPS, outbound
  provider access, account billing caps and live Meta text/label/complete-brief calls.
- Real business configuration/origins, SMTP account and inbox receipt; real permitted
  manufacturer PDFs and technician approval. `pdftotext` remains unavailable here;
  original PDF prepare/review/publish mechanics were preserved, not falsely reverified.
- Actual technician cases/grades, measured effort and outcomes. Synthetic responses,
  timer tests and mocked paired runs are mechanics, not accuracy or time-savings results.
- Fresh Chrome product/static-demo checks, 320px/zoom/keyboard and staff phone review.
- Private operator files outside the configured managed root and backup expiry require
  explicit operations policy; unknown usage/locks require manual billing reconciliation.
- Semantic assertion validation remains conservative; unrestricted diagnosis, full PDF
  viewer, adaptive automated evaluation and distributed budgets remain deferred.

The prior checkpoint below is retained as historical context only.

---

# Verification and remaining upgrade work — October 29, 2026

This is an implementation checkpoint, not a declaration that every NEXT_UPGRADE
acceptance criterion is complete. Base commit: `1d4e969`, branch `main`, remote
`ker2i/mendcue`. The implementation and this record are committed together locally.
The existing `NEXT_UPGRADE.md` was preserved and included. No push was performed. No repository-specific AGENTS.md was found.
Environment: Node 20.19.0, npm 11.17.0, Linux, real Chrome headless shell.
No live Meta requests or pilot measurements were made.

## Baseline executed before edits

- `npm test`: 51/51 passed, including six PGlite PostgreSQL-engine tests.
- `npm run typecheck` and `npm run build`: passed.
- `node scripts/browser-acceptance.mjs`: 24/24 passed.

## Implemented in this checkpoint

- Explicit model/serial separation; no arbitrary longest-token model guessing.
  Genuine provider ambiguity is preserved without flagging every 0/O/1/I.
  Label event retains extraction text, structured fields, attachment and uncertainty.
- Manual/photo identity control with editable brand/model/serial and private preview.
  Confirmation resolves transcription. Identity changes retire confirmation and clear
  draft assessment in both stores; submitted snapshots remain unchanged.
- Brand-bound exact model matching, enumerated family membership, and no restricted
  manual fallthrough to brand/category. Four coverage states are distinct.
  Chunk/document version and visibility must agree.
- Immutable evidence metadata in assessment and handoff JSON: document version/hash,
  title, source URL, PDF index, printed label, excerpt and applicability basis.
- Local operator PDF prepare/review/publish command, explicit usage basis, tenant-private
  versions and page boundaries. Migration 006 persists usage basis. It never fetches URLs.
- Conservative assessment display: generic observed issue areas with real supporting
  facts. Unvalidated model-specific diagnostic prose is withheld. Semantic validation
  of unrestricted model claims is **not implemented**. Seed example documents are
  excluded from live assessment retrieval until actually reviewed/imported.
- Fixed fixture-only brand word boundaries (GE cannot be extracted from “fridge”)
  and refrigerator/freezer complaint categorization.
- Version/rationale on question decision events. Existing active-question context,
  unknown handling, safety interruption and approved actions were preserved.
- Append-only technician decisions/corrections/missing-fact feedback and optional
  manual review duration, separate from conversation/workflow state. Staff roles,
  CSRF and tenant scope apply. No new disconnected demonstration database.
- Staff brief labels and coverage, excerpt expansion, private photo enlargement,
  stable case hash, desktop inbox/brief columns, compact review controls, persistent
  customer safety state and responsive identity card.
- Meta endpoint/model allowlist, bounded payload/output, shared local ledger,
  conservative reservations, per-case and lifetime global caps, one concurrent call,
  rate limit, price provenance, latency and reported usage. Unknown usage blocks
  further spending. Defaults: $2 local lifetime, $0.50 per case, 30 calls/case,
  30 requests/minute. These are estimates, not a provider billing guarantee.
- Versioned general Meta baseline prompt, private text-only fixed-input paired runner,
  randomized blind grading artifacts, case/withheld-outcome template, validated
  human-grade JSON/CSV exporter, demo script and runtime model inventory.

## Final checks

- `npm test`: 64/64 passed, including seven PGlite SQL tests. Added regressions cover
  identity correction, brand collisions, explicit family membership, source metadata,
  generic reduction of unsupported diagnostic claims, structured hazard input,
  immutable technician review, SQL usage basis/isolation, and spend uncertainty.
- `npm run typecheck`, `npm run build`: passed.
- Real Chrome acceptance: 28/28 passed, including actual technician approval save,
  stable case navigation, cross-origin intake, private photo access, queue polling,
  keyboard use, and 320px reflow. Final screenshots are rendered synthetic fixture
  pages; desktop 1440×900, phone approximately 390×844.
- `git diff --check`, JavaScript CLI/client syntax checks: passed.
- Grade exporter executed with an empty input set; no grades or outcomes invented.

Screenshots: [before hosted](screenshots/before-hosted.png),
[after hosted](screenshots/after-hosted.png), [before staff](screenshots/before-staff.png),
[after staff](screenshots/after-staff.png), [before phone](screenshots/before-phone.png),
[after phone](screenshots/after-phone.png). Before images use the baseline script's
viewports; staff default was 800px, hosted was 1280px. After desktop views use 1440px.
These are functional synthetic screens, not controlled visual-performance measurements.

## External evidence and deployment still missing

- No local Meta key. Text/label calls, actual model capabilities, refusal shapes,
  live latency and usage remain unverified. Live vision is gated by reviewed image
  billing configuration; large images can exceed the conservative byte ceiling.
- No real manufacturer PDFs or technician review were supplied. `pdftotext` is not
  installed here. Import CLI syntax/schema path was checked; real PDF extraction and
  publication remain unexecuted. No 3–6 model coverage claim is made. Existing example
  playbooks are explicitly labeled and do not establish reviewed pilot coverage.
- No anonymized jobs, technician-defined critical facts, blinded grades, actual
  review durations, or repair outcomes. No savings/accuracy claim or paired live
  results exist. See pilot-case-template and benchmark-method.
- Docker daemon is available, but `docker pull postgres:16-alpine` stalled after
  downloading some layers for over seven minutes; the attempt was stopped. No usable
  image was listed. Containerized PostgreSQL, full Compose/TLS boot and backup restore
  were not verified. PGlite is not a substitute for those deployment checks.
- Portal-specific submission fields/video duration remain unverified. Official public
  deadline was rechecked; see model-inventory.md for source links.

## Remaining implementation work

- Image-equivalent and complete service-brief comparison A (current runner compares
  raw structured **text-only assessments**, not full product handoffs); interactive
  comparison B still requires operator-recorded sessions. Do not claim adaptive
  questioning improvement from the current fixed-input runner.
- Technician-reviewed question metadata/expected-answer shapes and model-specific
  question catalog; technician identity-verification control and structured
  confirmation alternatives; pause/resume review timer (manual seconds work now).
- Real supported assertion catalog/semantic entailment checks before expanding beyond
  limited generic issue areas. Original document/page viewer is not yet implemented;
  immutable excerpts and metadata are available.
- Persisted evaluation cases/runs/grades in tenant-scoped database APIs. Current
  evaluation artifacts are private operator files, not publicly accessible endpoints.
- R13: atomic submission/outbox, stable webhook event identity, and durable scheduled
  retries remain open. At-least-once delivery only; no exactly-once claim.
- R14: image billing calibration, provider-side hard caps, multi-host budget controls,
  per-tenant spend allocation, telemetry aggregation, and crash/lock reconciliation.
  Audit retained ordinary logs before any real traffic.
- Full accessibility evaluation including zoom/reflow and staff phone usability;
  deployment retention/deletion and restore rehearsal before real customer use.

Next priority: supply permitted PDFs and technician model choices, execute their
reviewed import, configure capped Meta access, then validate a real text+label case
and complete the paired product brief/image runner before collecting pilot grades.
