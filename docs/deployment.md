# Deployment and operations

## Local development (no Postgres)

```bash
cp .env.example .env
npm install
npm test
MODEL_PROVIDER=fixture npm run build && node dist/server/index.js
```

- Hosted demo site: http://localhost:3000/business/demo-phoenix-appliance
- Second tenant: http://localhost:3000/business/demo-harbor-warranty
- Staff: http://localhost:3000/staff (see `src/content/seed.ts` for demo logins)
- Health: http://localhost:3000/healthz

## Docker Compose (VPS: 4 vCPU / 8 GB / 80 GB SSD starting estimate)

```bash
cp .env.example .env   # set POSTGRES_PASSWORD, APP_BASE_URL, MODEL_API_KEY
docker compose build
docker compose --profile seed up -d postgres migrate seed
docker compose up -d
```

Services: `caddy` (TLS, only 80/443 public), `web`, `worker`
(`SYNC_TURNS=0`, queued turns), `postgres` (private network, persistent
volume). Media persists in the `mediadata` volume.

Database roles: migration `002_rls.sql` creates an `app_runtime` role with
row-level-security policies as defense-in-depth. The Compose file runs the
app as the table owner for pilot simplicity (owner bypasses RLS), with
tenant scoping enforced at the application layer on every query.
Before live customer use, run migrations as the owner and switch the app's
`DATABASE_URL` to the `app_runtime` role so RLS is effective.

Set `MODEL_PROVIDER=live` and `MODEL_API_KEY` for real Meta calls
(base `https://api.meta.ai/v1`, model `muse-spark-1.3`, Standard mode).
Default without a key is the labeled fixture — the UI shows
"Development fixture/fallback mode — not a live model result."

## Migrations and rollback

- Migrations run via the `migrate` service on every deploy (`001`, `002`…).
- Images are versioned: `docker compose build web worker` tags the deploy;
  keep the previous images to roll back with `docker compose up -d`.
- App shows an honest degraded state when Postgres or the model is
  unreachable (health check fails; intake falls back; nothing is presented
  as live).

## Backup and restore (rehearse once before live use)

```bash
# Daily backup (cron on host):
docker compose exec -T postgres pg_dump -U intake intake | gzip > /backups/intake-$(date +%F).sql.gz
tar -czf /backups/media-$(date +%F).tar.gz -C /var/lib/docker/volumes mendcue_mediadata
# Expire backups after 30 days.

# Restore rehearsal:
gunzip -c /backups/intake-YYYY-MM-DD.sql.gz | docker compose exec -T postgres psql -U intake intake
```

Verify after restore: log in to `/staff`, open a known case reference,
confirm attachments load. Record the rehearsal date.

## Retention

Defaults per tenant config: abandoned drafts 7 days, closed-case
transcripts/media 90 days, redacted logs 14 days, backups 30 days.
Implement deletion as a scheduled job before live customer use (pilot TODO).

## Cost controls

- Bounded context, max 4 retrieved chunks, photo results reused.
- `GLOBAL_AI_SPEND_LIMIT` (daily USD) is read by the worker; when exceeded,
  turns fall back to deterministic intake (enforced in the spend-guard
  release — currently log + fallback at the provider layer).
- Track per-case token usage from provider responses; the illustrative
  50k-in/5k-out case (~$0.084 at $1.25/$4.25 per M) must be replaced by
  measured numbers. Recheck Meta pricing before launch.
