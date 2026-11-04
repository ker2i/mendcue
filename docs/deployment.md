# Deployment

This guide deploys MendCue with PostgreSQL, private persistent media, a web process,
a background worker, and HTTPS. Run commands from the repository root in Bash.
Use a fresh database/project for a new deployment. Existing deployments should use
[Updates](#updates) rather than repeating initial provisioning.

## 1. Prepare the server and domain

You need:

- An always-on Linux server with Git, Docker Engine, Docker Compose v2, OpenSSL,
  and permission to run Docker commands.
- A backend hostname such as `intake.example.com` and access to its DNS records.
- Inbound TCP ports 80 and 443 for Caddy, plus outbound HTTPS for Meta and image pulls.
  Keep PostgreSQL private; Compose publishes no database port.
- A Meta API key only if you want live inference. Fixture mode needs no key.

For direct HTTPS, point the hostname's A record to the server. Add an AAAA record
only if IPv6 routing works. Caddy provisions the TLS certificate automatically.
The business's static website can remain on its existing host and domain.

```bash
git clone https://github.com/ker2i/mendcue.git
cd mendcue
docker --version
docker compose version
cp .env.example .env
chmod 600 .env
```

## 2. Configure the private environment

Edit `.env` on the server. Do not commit it or put its contents in a submission.

| Variable | Set it to |
| --- | --- |
| `DOMAIN` | Your backend hostname, without `https://` |
| `APP_BASE_URL` | The same hostname with `https://`, without a trailing slash |
| `POSTGRES_PASSWORD` | A new random database-owner password |
| `APP_RUNTIME_PASSWORD` | A different random runtime database password |
| `SESSION_SECRET` | A random secret of at least 32 characters |
| `SECRET_ENCRYPTION_KEY` | A different random secret of at least 32 characters |
| `MODEL_PROVIDER` | `fixture` initially, or `live` for real Meta requests |
| `MODEL_API_KEY` | Your server-side Meta key when using `live` |
| `GLOBAL_AI_SPEND_LIMIT` | Your deliberate positive total estimated allowance in USD |

Generate each of the four passwords/secrets separately with `openssl rand -hex 32`
and paste the result into the corresponding setting. Hex avoids URL escaping issues
for database passwords. Keep `NODE_ENV=production`, `SYNC_TURNS=0`, and the default
absolute media/ledger paths. Compose supplies the correct `DATABASE_URL` separately
for migrations and the restricted web/worker role; do not replace it with an owner
URL in the running application.

Web and worker must share provider settings, SQL, media, and the usage ledger.
The allowance is a shared local estimate, not a provider-enforced billing limit.
Each request reserves a conservative estimate before network access. Measured token
usage replaces it when available. Failures and responses without token counts retain
their reservation and still count toward both caps; they do not block unrelated
customers while allowance remains. These reservations are estimates, not invoices.
Legacy null-cost records still require explicit reconciliation.
`META_CASE_USD_LIMIT` and `META_CASE_CALL_LIMIT` provide additional case limits.

Leave `META_IMAGE_BILLING_REVIEWED=0` until image billing/reservations have been
reviewed for your account. Manual identity entry remains available. SMTP and push
are optional and can stay disabled during initial setup.

### Model versions and images

MendCue uses the Meta Muse Spark family; this release is validated with and pins
`muse-spark-1.3`. Both startup validation and the API adapter reject other model IDs.
Changing `META_MODEL` alone does not enable a newer version. Before adopting one,
validate its structured-output schemas, supported request parameters, image handling,
latency, and prices, update both model guards and pricing settings, then rerun the
text and photo workflows. Historical usage records retain their original model and
prices.

Muse Spark 1.3 itself supports image understanding through the Chat Completions
endpoint used here. See Meta's [image-understanding documentation](https://dev.meta.ai/docs/image-understanding).
MendCue's photo upload/storage and AI label transcription are separate capabilities.
Live label transcription requires `META_IMAGE_BILLING_REVIEWED=1` after reviewing
the image reservation and allowance. Leave it disabled if that deployment has only
been verified for text intake; changing model-version wording does not enable it.

## 3. Build, migrate, and set the runtime password

```bash
docker compose build
docker compose up -d --wait postgres
docker compose run --rm migrate
```

Migration 002 creates `app_runtime` with a historical initial password. **Before
starting web or worker**, replace that password with the exact value you chose for
`APP_RUNTIME_PASSWORD` in `.env`. This command prompts twice without placing the
password in a shell argument or SQL history:

```bash
docker compose exec postgres psql -U intake -d intake -c '\password app_runtime'
```

Migrations are recorded transactionally and can be rerun. Do not edit historical
SQL files. All migrations in `migrations/`, including the technician app schema,
are applied by the migration command.

## 4. Provision a business and owner

Keep the completed configuration under ignored `data/`, or in a private directory.

```bash
mkdir -p data
chmod 700 data
cp docs/tenant-config.example.json data/tenant.json
chmod 600 data/tenant.json
```

Edit `data/tenant.json`:

- Choose a unique `id` and URL-safe `slug`, and set the business name and timezone.
- Set contact details, appliance categories, service ZIPs, and required fields.
  `serviceZips: null` accepts any ZIP.
- Set `allowedOrigins` to exact website origins, such as `https://www.example.com`.
  Include each origin actually used. Do not include paths or trailing slashes.
- Replace `publicKey` with `pk_` followed by a fresh `openssl rand -hex 24` result.
  This is a public widget identifier, not a staff credential.
- Review the opening message, privacy wording, retention, and local utility contact.
  Keep email notifications disabled until a real destination and SMTP are configured.

Provision using the migration/owner role. Replace the sample email/name below with
your owner account. Enter a unique 16–256 character password at the hidden prompt.

```bash
read -rs -p 'New owner password: ' staff_password
printf '\n'
printf '%s' "$staff_password" | docker compose run --rm -T --no-deps \
  -v "$PWD/data/tenant.json:/run/tenant.json:ro" \
  --entrypoint node migrate dist/operator/provision.js \
  provision /run/tenant.json owner@example.com 'Owner'
unset staff_password
```

Provisioning rejects an existing tenant. To rotate an existing staff password,
use the same hidden-prompt pattern with:

```bash
read -rs -p 'Replacement owner password: ' staff_password
printf '\n'
printf '%s' "$staff_password" | docker compose run --rm -T --no-deps \
  --entrypoint node migrate dist/operator/provision.js \
  rotate YOUR_TENANT_ID owner@example.com
unset staff_password
```

Rotation revokes existing staff sessions. Do not seed demo accounts into a real
business database. To create only the two synthetic demo tenants in an isolated
judge/test deployment, run `docker compose --profile seed run --rm seed` instead
of provisioning a real business. Their credentials are published fixtures.

## 5. Start and verify

For direct HTTPS:

```bash
docker compose up -d web worker caddy
docker compose ps
```

Replace the hostname and slug below with your settings:

- `https://intake.example.com/healthz` should return `ok: true`,
  `database: postgres`, `durable: true`, and your intended `provider`.
- `https://intake.example.com/business/YOUR-SLUG` should show your business intake.
- `https://intake.example.com/staff/?business=YOUR-SLUG` should accept your owner login.

Submit one synthetic request, review it before sending, and find its saved brief in
the owner inbox. Check worker health with `docker compose ps`; in queued mode the
worker must be healthy and process the request. HTTP health alone does not prove
Meta inference. For a live check, confirm a successful assessment in the resulting
brief and inspect usage with the private ledger diagnostic tool.

To switch from fixture to live, set `MODEL_PROVIDER=live`, `MODEL_API_KEY`, and an
explicit positive allowance in `.env`, then recreate both callers:

```bash
docker compose up -d --force-recreate web worker
```

Connect your website using [integration.md](integration.md).

## Alternative: Cloudflare Tunnel

Use this instead of Caddy if your server cannot accept inbound HTTPS. Create a
Cloudflare Tunnel in your account, map your backend hostname to **HTTP `web:3000`**,
and add `CLOUDFLARE_TUNNEL_TOKEN` to private `.env`. Use the same public HTTPS
`APP_BASE_URL`. Complete the database and owner steps above, then start:

```bash
docker compose -f compose.yaml -f compose.tunnel.yaml up -d web worker cloudflared
```

Start only these named services so Caddy does not bind ports. For an existing Caddy
installation, stop it before switching. Use the same two `-f` options for subsequent
application/tunnel operations. The host must stay running; a tunnel inside a paused
machine cannot wake that machine when a customer visits.

See [Cloudflare's tunnel setup](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/).

## Notifications and technician app

For email, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, and credentials in `.env`;
then enable the tenant's `notifications.emailEnabled` with a real `emailTo` before
provisioning. Port 465 uses TLS; other production ports use STARTTLS. Verify actual
inbox receipt separately from SMTP acceptance.

For installable phone access, appointments, and optional VAPID push configuration,
see [technician-app.md](technician-app.md). Keep the same private VAPID pair across
restarts and on both web and worker. Physical-device delivery needs a device check.

## Updates

Back up first, then pull reviewed source changes. Stop callers while migrating and
rebuild both processes together:

```bash
docker compose stop web worker
bash scripts/backup.sh /private/backups
git pull --ff-only
docker compose build
docker compose run --rm migrate
docker compose up -d web worker caddy
```

For Tunnel, use its two-file command for the final `up`, with `web worker cloudflared`.
Do not start the same installation on a second host with a copied live usage ledger.

## Backup and restore

SQL, private media, and the usage ledger form one backup pair. Stop both callers
before capture; keep archives private and copy them to protected off-server storage.

```bash
docker compose stop web worker
bash scripts/backup.sh /private/backups
docker compose up -d web worker
```

Restore only trusted matching archives, preferably into a fresh rehearsal project
with an empty media volume:

```bash
docker compose up -d --wait postgres
bash scripts/restore.sh /private/backups/sql-TIMESTAMP.sql.gz /private/backups/media-TIMESTAMP.tar.gz
```

The restore script starts callers at the end. On a fresh cluster, set `app_runtime`'s
password as in step 3 **before running the restore script**: first run migrations,
then the password command. PostgreSQL dumps exclude role passwords. Verify staff
login, case references, photos, queue processing, and ledger continuity afterward.
Keep the deployment `.env` in a separate protected backup.

Retention runs in the worker. Tenant `draftDays` applies to unsubmitted cases,
`closedDays` to closed/cancelled cases, and `logDays` to recognized private operator
exports. Active cases and pending work are preserved. Backups and ordinary host logs
need their own expiry policy; case deletion does not reset spending.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Startup rejects configuration | HTTPS `APP_BASE_URL`, generated 32+ character secrets, explicit provider, and the `.env` template |
| Database authentication fails | Runtime role password must exactly match `APP_RUNTIME_PASSWORD`; changing `.env` alone does not rotate SQL credentials |
| Existing PostgreSQL rejects a changed owner password | `POSTGRES_PASSWORD` initializes new volumes only; rotate existing database credentials deliberately |
| TLS certificate fails | DNS resolves to this host and ports 80/443 are reachable |
| Customer messages remain queued | Worker health, matching provider settings, SQL connectivity, and Settings → Background delivery and processing |
| Widget cannot open | Exact website origin is in the correct tenant's `allowedOrigins`; use the right public key |
| No live assessment | Valid Meta key/model access, available allowance, usage uncertainty, and provider failures |
| Image reading unavailable | Reviewed image-billing setting and upload size/format; use manual identity entry |

`docker compose logs --tail=100 web worker` helps diagnose startup and processing.
Keep logs private. `node scripts/model-diagnostics.mjs /private/meta-usage.json`
(on an operator workstation with Node) summarizes a private ledger without printing
prompts or images. Provider failures record status/code/request identifiers without
provider messages or customer content. Prefer reconciliation against provider billing.
For a legacy request independently verified to be **text only**, an operator can
instead reserve the maximum enforced text-request cost (120,000 serialized bytes,
8,192 input-token margin and 2,048 output tokens, at that record's prices):

```bash
node scripts/reconcile-model-usage.mjs /private/meta-usage.json CASE_ID RECORDED_AT \
  'Verified text-only request; reserving the enforced maximum instead of actual billing'
```

The command locks the ledger, requires exactly one matching null-cost record, saves
a backup and records its basis/time while preserving the failed request and all
other spending. It does not confirm actual charges, raise allowances or clear stale
locks. Never use text-only reconciliation for an unverified image request, and do
not delete/reset the ledger to regain budget. New requests already retain their
individual reservations if they fail.

## Native Node operation

For operators running without Compose: install Node 20+ and npm, run `npm ci` and
`npm run build`, and provide an owner `DATABASE_URL` for `npm run migrate` and
`npm run operator`. Give `npm start` and `npm run worker` the restricted runtime
`DATABASE_URL`, identical production/provider configuration, absolute persistent
media/ledger paths, and an HTTPS reverse proxy. A separate in-memory worker cannot
share the web process's memory store. Use README's synchronous mode for local demos.
