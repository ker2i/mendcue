# Paired benchmark protocol — v1

A: `npm run build`, then run `scripts/run-comparison.mjs` on a private case input.
An explicit `GLOBAL_AI_SPEND_LIMIT` and Meta key are required. Two requests at most
per case, same model, input facts, source chunks, schema and output token ceiling.
The current runner measures **text-only fixed-input generation**. It does not yet
measure image understanding, full submitted MendCue handoffs, or adaptive questioning.
Raw assessments are retained before application filtering; do not call them final
product briefs. Baseline prompt and its hash are versioned. Model/usage records
live in `data/meta-usage.json`. Configured live mode alone is not a successful call.
Use `.blind.json` for human grading and keep `.key.json` away from the grader.
Withheld outcomes are never loaded by the runner. Randomize run and grading order.

B: separately start both systems from the same initial complaint. An operator uses
a fixed source truth record to answer only observations actually known. Record
each system's questions and actual replies independently; do not replay one
system's transcript to claim adaptive comparison. General assistant baseline must
receive the same photos/manuals and the baseline prompt. Interactive automated
runner and image parity remain pending; use recorded operator sessions meanwhile.

Report each paired case and grade, missing facts, unsupported assertions, identity
and applicability checks, extra follow-up, active review/edit time, question count,
duplicates, latency, usage, failures, mode and versions. Completeness denominator:
known applicable critical facts expected; report unavailable facts separately.
Exclude cases without model sources from model-specific grounding denominators.
Aggregate with sample sizes and missing measurements; separate synthetic and real.
No generated percentage, business savings or accuracy claim is justified by fixtures.

Ledger controls assume one shared filesystem across web and worker. Lock contention
falls back rather than issuing concurrent requests. Unknown usage or an interrupted
request blocks further calls until an operator reconciles the ledger. Price assumptions:
Standard Muse Spark input $1.25/M and output $4.25/M, effective 2026-10-29,
[Meta pricing](https://dev.meta.ai/docs/pricing-rate-limits). They are estimates,
not provider invoices. Set `META_INPUT_USD_PER_MILLION` and
`META_OUTPUT_USD_PER_MILLION` if pricing changes. Default lifetime local cap is $2;
comparison runs require an explicit cap. Byte-based reservations include margin;
provider-side billing caps and real image usage calibration remain required before
public traffic. No multi-host/global distributed budget claim is made.
