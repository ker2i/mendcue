# MendCue (hackathon scope)

From customer symptoms to repair-ready handoffs. Tenant-aware appliance
service intake: one shared engine serves an embedded widget, a hosted
business site, a staff dashboard, and a REST API.

> Demonstration build. Two clearly labeled demo businesses are seeded; no
> real company details are included. **Not insurer production ready. No
> universal appliance knowledge is claimed** — model-specific guidance
> depends on available approved documentation.

## Quick start

Two local modes. Pick one.

**Mode A — single process, in-memory store (no database):**

```bash
npm install
npm test
npm run build
PORT=3000 APP_BASE_URL=http://localhost:3000 MODEL_PROVIDER=fixture SYNC_TURNS=1 node dist/server/index.js
```

**Mode B — full stack with Postgres (Docker Compose):**

```bash
cp .env.example .env   # then edit .env: passwords, domain, keys
docker compose build
docker compose --profile seed up -d postgres migrate seed
docker compose up -d
```

- Hosted pilot site: http://localhost:3000/business/demo-phoenix-appliance
- Second tenant: http://localhost:3000/business/demo-harbor-warranty
- Staff: http://localhost:3000/staff
  (`tech@demo-phoenix.invalid` / `demo-tech-1234`,
  `dispatch@demo-harbor.invalid` / `demo-dispatch-1234`)
- API spec: `docs/openapi.yaml`
- Health: `GET /healthz`

Live Meta calls: set `MODEL_PROVIDER=live` + `MODEL_API_KEY`
(Standard mode, `muse-spark-1.3` at `https://api.meta.ai/v1`).
Choose `MODEL_PROVIDER=fixture` explicitly for a labeled development fixture.
Live mode without a key fails startup. Web and worker share the same validated
configuration; production requires durable SQL and private persistent media.
See [deployment and operations](docs/deployment.md) for provisioning, SMTP, retries,
retention, image budgets and backup/restore.

## Layout

- `src/domain/` — intake engine, safety, questions/actions, knowledge, facts
- `src/integrations/meta/` — provider contract, live Meta adapter, fixture
- `src/domain/` — intake engine, safety, questions/actions, knowledge, facts
- `src/integrations/meta/` — provider contract, live Meta adapter, fixture
- `src/server/` — API, staff/integration auth, page shells
- `src/server/ui/` — shared CSS + dependency-free clients (widget, intake, staff, hosted)
- `src/worker/` — durable job processing (turns, labels, webhooks)
- `src/db/` — store interface, memory + Postgres implementations, migrations, seed
- `migrations/` — SQL schema, RLS, narrow auth paths, composite FKs
- `tests/` — intake, safety, isolation, labels/knowledge, fallback, review regressions, PG integration
- `scripts/browser-acceptance.mjs` — real-Chrome acceptance run (41 checks)
- `docs/` — openapi, architecture, deployment, tenant-onboarding, evaluation
- `examples/integration/` — mock webhook receiver + embed snippet

## Verification

```bash
npm test          # API + engine suites (memory store) + PGlite PostgreSQL-engine integration
npm run typecheck
npm run build && node scripts/browser-acceptance.mjs   # discovers Chrome; CHROME_BIN overrides
node scripts/knowledge-acceptance.mjs                 # synthetic PDF checks; needs pdftotext
```

See `docs/evaluation.md` for the 12-scenario reviewed set and pilot grading.

The next-upgrade implementation and honest remaining work are recorded in
[verification-latest](docs/verification-latest.md). See the
[local document import workflow](docs/knowledge-import.md),
[paired benchmark protocol](docs/benchmark-method.md), and
[private case collection template](docs/pilot-case-template.md).
Live mode uses a shared local spending ledger (default $2 lifetime cap,
$0.50 per case); unknown usage blocks further requests. Reconcile failed
requests with provider billing before resetting it. Live vision requires
reviewed billing configuration; manual identity entry remains available.
