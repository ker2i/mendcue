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
Without a key the app uses a **labeled development fixture** — the UI and
API mark it as such and never present it as a live model result.

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
- `scripts/browser-acceptance.mjs` — real-Chrome acceptance run (24 checks)
- `docs/` — openapi, architecture, deployment, tenant-onboarding, evaluation
- `examples/integration/` — mock webhook receiver + embed snippet

## Verification

```bash
npm test          # API + engine suites (memory store) + real-Postgres integration
npm run typecheck
npm run build && node scripts/browser-acceptance.mjs   # needs CHROME_BIN
```

See `docs/evaluation.md` for the 12-scenario reviewed set and pilot grading.
