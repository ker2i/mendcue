# Architecture

One TypeScript application, one shared intake engine, four surfaces.

```
widget / hosted site / staff dashboard / REST API
        └─▶ versioned API (/api/v1) ─▶ domain/intake engine
                                            ├─▶ safety rules + approved questions/actions
                                            ├─▶ Meta provider adapter (live) or fixture (dev)
                                            ├─▶ approved knowledge retrieval (exact → family → category)
                                            └─▶ durable jobs (turns, labels, webhooks)
        └─▶ Postgres (+RLS) and private media volume
```

Key files:

- `src/domain/intake.ts` — turn pipeline, label processing, submission/handoff.
- `src/domain/safety.ts` — deterministic hazard screening, forbidden actions.
- `src/domain/questions.ts` — approved question + customer-action registries.
- `src/domain/knowledge.ts` — applicability, retrieval order, citation validation.
- `src/integrations/meta/` — `provider.ts` contract, `meta.ts` live adapter,
  `fixture.ts` deterministic dev fixture (always labeled, never live).
- `src/server/` — Express routes, staff/integration auth, pages.
- `src/worker/` — leased job processing with retry/backoff; one job per
  message, FIFO-serialized per case.
- `src/db/` — `store.ts` interface, `memory.ts` (tests/dev), `pg.ts` (prod),
  `migrate.ts`, `seed.ts`.
- `migrations/` — schema, row-level security, narrow `SECURITY DEFINER`
  auth/worker paths, composite tenant/case foreign keys.
- `src/server/ui/` — shared CSS plus dependency-free clients served as
  static assets under a restrictive CSP (widget loader, intake sheet,
  staff workspace); all rendering is text-node based.

Pending customer decisions (label confirmation, fact conflict, out-of-area)
are explicit persisted case state, resolved only by affirmative, negative,
or valid-correction answers. Hazard screening runs before every other
branch on every turn path, including queued intake.

## Trust boundaries

- Customer text/photos are untrusted evidence: no policy change, no secret
  reveal, no network access from message content.
- Model output is unvalidated until server checks: fact keys, question/action
  ids, preconditions, hazard exclusions, citation ids.
- Tenant isolation: `tenant_id` on every row, app-level scoping on every
  query, Postgres RLS as defense-in-depth, tenant in cache keys (no shared
  cache of private data in this release).

## Failure posture

- Model timeout/refusal/invalid output → one bounded retry where apt, then
  deterministic fallback intake; handoff marked `assessment_unavailable`.
- Worker crash → lease expiry lets another worker recover; turn jobs dedupe
  per case; webhook jobs retry with exponential backoff.
- Client refresh → persisted state + `Idempotency-Key` prevent duplicates.

## What this is not

- Not insurer production ready: no SSO, no dedicated retention/infra, no
  claims-system connector (generic signed webhook only).
- Not universal appliance knowledge: 5 approved general playbook chunks for
  3 categories; exact-model docs arrive via the ingestion flow with review.
