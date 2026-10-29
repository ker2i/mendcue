# MendCue (hackathon scope)

From customer symptoms to repair-ready handoffs. Tenant-aware appliance
service intake: one shared engine serves an embedded widget, a hosted
business site, a staff dashboard, and a REST API.

> Demonstration build. Two clearly labeled demo businesses are seeded; no
> real company details are included. **Not insurer production ready. No
> universal appliance knowledge is claimed** — model-specific guidance
> depends on available approved documentation.

## Quick start

```bash
cp .env.example .env
npm install
npm test
npm run build
node dist/server/index.js
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
- `src/server/` — API, staff/integration auth, pages (embed/hosted/staff)
- `src/worker/` — durable job processing (turns, labels, webhooks)
- `src/db/` — store interface, memory + Postgres implementations, migrations, seed
- `migrations/` — SQL schema + RLS
- `tests/` — intake, safety, isolation, labels/knowledge, fallback suites
- `docs/` — openapi, architecture, deployment, tenant-onboarding, evaluation
- `examples/integration/` — mock webhook receiver + embed snippet

## Verification

```bash
npm test          # unit + API suites (seeded memory store, fixture provider)
npm run typecheck
```

See `docs/evaluation.md` for the 12-scenario reviewed set and pilot grading.
