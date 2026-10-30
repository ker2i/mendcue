# Paired benchmark protocol — v2

`npm run build`, then run `scripts/run-comparison.mjs` with a private case JSON.
An explicit `GLOBAL_AI_SPEND_LIMIT` and server-side Meta key are required. Input
contains `kind`, validated `tenant`, intake `facts`, reviewed `documents`, versioned
`chunks`, and up to one local label image path (relative to the input JSON). See the
TypeScript `ProductSample` contract and the CLI's Zod schemas. No database evaluation
API is required. Only known intake keys are accepted; duplicate keys and repair
outcome keys are rejected. Keep actual repair outcomes in a separate withheld file.

The runner now compares **complete fixed-input service briefs**. MendCue uses the
real `submitCase` pipeline, grounding/filtering and immutable snapshot generation.
A preflight captures that pipeline's exact retrieved facts/chunks/source metadata
and private inference derivative without calling a model. The general Meta baseline
receives those same inputs. Both use Standard `muse-spark-1.3`, the same request
ceiling, 2048 output tokens and reviewed image-billing gate. The baseline generates
a complete brief independently; MendCue adds its deterministic fact/snapshot assembly.
That application behavior is part of what is being compared and must be disclosed.

At most two paid requests are attempted per case, with randomized system order.
Both share the lifetime/per-case cap and usage ledger. An unknown first-request cost
can correctly block the second. Paired inputs are fixed, not adaptive interviews;
identity is not automatically customer-confirmed merely because an image is supplied.
No fixture or mocked response establishes live readability or product quality.

Private artifacts preserve raw product snapshot/assessment, validated baseline
output, model/prompt/source hashes, equivalent input, original-image hashes,
latency and ledger usage records, and partial failures. A separate `.blind.json`
uses identical review-field names and randomized A/B ordering. Keep `.key.json`
and `.private.json` away from the grader. Structural style may still reveal a system;
this is randomized labeling, not a guarantee of perfect blinding. Grade failures too.

Outputs live under `OUTPUT-ROOT/TENANT-ID/`. `PRIVATE_ARTIFACT_ROOT` supplies the
default root and can share the worker's managed retention directory. Keep all such
files private/ignored, including source PDFs and anonymized photographs. Old raw
text-assessment runs remain available via `scripts/run-raw-comparison.mjs`; never
pool those results with complete-brief runs without identifying the experiment.

B remains a separate operator-recorded adaptive-questioning experiment: begin each
system with the same initial complaint, supply only truth-record observations actually
known, and record each system's own questions/replies. Do not replay one transcript
to claim adaptive improvement. Automated adaptive comparison is not implemented.

Use `docs/pilot-case-template.md` for 5–10 later anonymized technician cases. Declare
critical facts before grading. Record review corrections, missing critical facts,
unsupported assertions, identity/applicability, human follow-up, active review effort,
latency/tokens/cost, question counts, failures, versions and real/synthetic sample
counts. Timer measurements, manual seconds and case age are distinct. The product's
explicit pause/resume timer stores append-only actor-scoped intervals and attempts
to pause on tab hiding/navigation; after a browser crash an unpaused interval must
be reviewed as uncertain rather than claimed as measured active effort.

`scripts/grade-comparison.mjs` exports individual JSON/CSV grades and explicit missing
measurements. It accepts optional latency/input/output-token/cost fields from private
run records. No accuracy/time-savings percentage or pilot result is inferred from
synthetic inputs or generated grades. No real grades are supplied by this repository.

Ledger controls assume one shared filesystem. Unknown usage blocks further calls;
stale locks require operator reconciliation with provider billing before release.
Historical price assumptions recorded 2026-10-29 are Standard Muse Spark input
$1.25/M and output $4.25/M, from [Meta pricing](https://dev.meta.ai/docs/pricing-rate-limits).
They were not revalidated by this implementation session and remain configurable
estimates, not invoices or provider hard caps. The image/request byte ceiling and
reservation formula remain unchanged. Review actual image billing before enabling
live vision or exposing public live traffic; multi-host budgeting is not implemented.
