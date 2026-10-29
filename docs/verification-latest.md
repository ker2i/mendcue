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
