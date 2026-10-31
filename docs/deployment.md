# Deployment and operations

Web and worker use the same validated startup policy. `MODEL_PROVIDER` must be
explicitly `fixture` or `live`; a key never selects a mode. Live mode without a key
fails startup. Fixture mode remains visibly labeled even when a key is present.
Production requires PostgreSQL, HTTPS `APP_BASE_URL`, non-placeholder secrets of
at least 32 characters, and absolute persistent media and ledger paths. Live
production also requires an explicit positive spending cap. Errors name settings
without printing their secret values. `/healthz` identifies memory as non-durable
and omits database error details. Readiness does not establish successful inference.

## Local fixture development

```bash
npm install
npm test
npm run build
NODE_ENV=development DATABASE_URL= MODEL_PROVIDER=fixture SYNC_TURNS=1 MEDIA_STORAGE_PATH=./data/media node dist/server/index.js
```

Memory is intentionally seeded for local demos. Restart resets its database;
media files remain until explicitly removed. A separate memory worker has its own
store: use synchronous turns for this mode. `/staff` has the synthetic seed logins;
never seed those users into a real pilot database.

## Compose / VPS

Copy `.env.example` to a private `.env` (`chmod 600 .env`). Supply database passwords,
HTTPS origin/domain, generated session/encryption secrets and explicit provider mode.
For a supervised fixture deployment, choose `fixture` deliberately and retain the
fixture labels. For live inference supply the server-side Meta key, shared ledger,
reviewed billing settings and a deliberately configured positive cap.

```bash
docker compose build
docker compose up -d postgres migrate
docker compose up -d web worker caddy
```

Use the optional `seed` profile only for an isolated synthetic demonstration.
The web and worker connect with the restricted `app_runtime` credentials, not the
migration owner's URL. Migration 002 historically initializes its password to
`change_me_in_production`; rotate it with a private administrative SQL session and
set the matching `APP_RUNTIME_PASSWORD`. Owner and runtime passwords are distinct.
Compose now requires both variables rather than silently choosing defaults.

Apply new migrations **007 and 008** before starting this version. Migration 007
adds due times, queue order, lease generations, bounded operator retries and stable
per-endpoint delivery records. Migration 008 records the hash of upload bytes before
normalization. Historical migrations are unchanged. Roll back application and schema
as a coordinated operation; old workers use incompatible helper signatures.
The migration runner commits each file's schema changes and its migration record
in one transaction on one connection. A failure rolls back that file for a safe retry.

SQL, media and the estimated usage ledger must persist across both processes.
Compose mounts the same media volume and ledger path in each. `MEDIA_STORAGE_PATH`
is pinned to that volume. Worker health requires a recently completed polling cycle,
not merely a matching PID. It performs no health-check inference. Public web health
checks do not prove worker progress; inspect worker health and staff job states too.

## Private technician provisioning and rotation

No public signup is added. Copy [tenant-config.example.json](tenant-config.example.json)
to a private file, set real identity/contact/origins/service ZIPs and a random public
widget key. `src/tenant-config.ts` validates every configuration field. Do not borrow
demo credentials, claim example documents are reviewed, or enable mail without a
real recipient. Build, then use a secret manager pipe or a hidden shell prompt:

```bash
read -rs -p 'New staff password: ' staff_password
printf '%s' "$staff_password" | npm run operator -- provision /private/tenant.json owner@example.com 'Owner'
unset staff_password
# Rotation uses the existing tenant ID and staff email:
read -rs -p 'New staff password: ' staff_password
printf '%s' "$staff_password" | npm run operator -- rotate tenant_id owner@example.com
unset staff_password
```

Use a password of 16–256 characters. The CLI reads only stdin for passwords, uses
salted scrypt, and wraps provisioning/rotation in a transaction. Rotation revokes
existing staff sessions. `DATABASE_URL` must identify the intended private database.
The tenant config is operator managed; provisioning rejects an existing tenant.

The independently built website can link to `https://INTAKE/business/TENANT-SLUG`
or load the existing widget:

```html
<script src="https://INTAKE/widget/v1.js" data-public-key="PUBLIC-KEY" data-mode="launcher" defer></script>
```

Add the real website's exact origin to `allowedOrigins`. Staff sign in at `/staff`
with the provisioned tenant slug. Domain/DNS and the repairman's site are separate.

## Notifications, failures and retries

Enable `notifications.emailEnabled` and set `emailTo` in the tenant configuration.
Configure `SMTP_HOST`, `SMTP_PORT` (465 for TLS or STARTTLS on other production
ports), `SMTP_FROM`, and account credentials if required. No email service is
assumed or provisioned. Missing credentials/configuration leave visible failed work.
The local SMTP regression proves mechanics only, not delivery to the real technician.

Submission commits the snapshot, assessment, case transition, audit event and outbox
atomically. Repeated/concurrent submissions return the winning handoff. Staff status
changes commit their audit/outbox with the case too. Logical webhook IDs, timestamps
and payloads survive retries. Successful endpoints are skipped on subsequent attempts;
receivers must deduplicate `x-intake-event-id`. Delivery is at least once: a crash
between receiver acceptance and recording success can repeat a request. SMTP uses a
stable Message-ID; that does not guarantee mailbox deduplication or final delivery.
Messages contain only a reference and authenticated staff link, never photos or
transcripts. Successful SMTP acceptance does not establish inbox receipt.

Staff **Settings → Background delivery and processing** shows pending/leased/failed
work and due times. Mutating staff can retry a failed job up to three times through
that UI (`POST /api/v1/staff/jobs/:id/retry`). Each operator retry resets the bounded
attempt batch; it retains payload, event identity and successful endpoint progress.
Expired leases recover; stale workers cannot complete newer lease generations.
An unavailable/failed earlier job blocks later work for the same case and channel;
webhooks and email have independent ordering. After the retry limit, investigate
privately rather than creating unbounded retries or editing the original event.
No public endpoint exposes job payloads or raw provider/storage errors.

## Private image policy

Uploads accept still JPEG/PNG/WebP up to 8 MiB and 24 million decoded pixels. Two
concurrent pipelines per process, one libvips thread, disabled cache and five-second
per-pipeline timeouts bound processing. Animated/malformed/oversized files fail with
manual-entry guidance. Full-dimension orientation-corrected WebP replaces upload
bytes in private storage; EXIF/XMP/ICC metadata is removed. Original upload bytes
are not retained. Both original-byte and normalized-byte hashes preserve provenance.

A separate in-memory JPEG derivative supplies vision, up to 75,000 bytes (100,000
base64 bytes), leaving room for text/schema inside the unchanged 120,000-byte request
ceiling. It tries 1920/1600/1280px and qualities 85/70/55 without enlarging inputs.
It never shrinks below a 1280px long edge to force a dense image to fit. A photo that
cannot fit falls back to manual identity entry or a clear crop. Derivatives are not
public assets or permanent extra files. Submitted assessments can use the latest
label photo with the same budget and billing gate. Neither compression nor local
fixtures prove that a real label is readable by Meta.

## Cost diagnostics and crash reconciliation

Web and worker must use the same `META_USAGE_LEDGER`. Reservations use the bounded
serialized request plus output allowance; unknown usage stops subsequent spending.
The cap is a single-host local estimate, not provider billing enforcement. Do not
open public live traffic without reviewed account billing limits and a deliberate
cap. Never automatically delete a stale lock or reset an unknown-usage record.

`node scripts/model-diagnostics.mjs /private/meta-usage.json` reports counts,
latencies, reported tokens, estimated costs and uncertainty without prompts/images.
HTTP success is distinct from valid output or diagnostic quality. After a crash,
stop both callers, back up ledger and lock, reconcile the specific case/time with
provider billing, record actual tokens/cost and an operator reconciliation note in
private audit records, and only then repair the backed-up ledger/release the lock.
If usage cannot be bounded, retain the stop. Never erase prior spend to regain cap.

## Retention

The worker checks hourly, in batches of 100 SQL cases per tenant. Tenant `draftDays`
applies to unsubmitted drafts; `closedDays` applies to closed/cancelled cases. Active
submitted cases and cases with pending/leased work remain. Expired sessions are
removed. Case dependencies are removed transactionally while a detached deletion
job retains only private storage keys. Media deletion is idempotent/retryable, and
successful deletion clears that payload. The usage ledger is retained separately
for accounting; case deletion never resets spending.

When configured, `PRIVATE_ARTIFACT_ROOT/TENANT-ID/` exports expire after tenant
`logDays`. Only recognized `.private.json`, `.blind.json`, `.key.json`, `.grades.json`
and `.grades.csv` files are deleted; symlinks are not followed. Set the comparison
runner's root to that same path. Operator files outside this managed root, legacy
unscoped exports, host/application logs and temporary import PDFs need explicit
private cleanup. Backup expiry is independent (default operational policy: 30 days).

## Backup and restore

Use a private directory outside the repository. Quiesce web and worker for a matching
SQL/media pair, including the ledger. `scripts/backup.sh` uses Compose mounts, so it
does not guess Docker volume names. Restart after capturing both files.

```bash
docker compose stop web worker
bash scripts/backup.sh /private/backups
docker compose up -d web worker
```

Restore only trusted backups, preferably into a fresh rehearsal project/empty media
volume. Start PostgreSQL, then `bash scripts/restore.sh SQL.sql.gz MEDIA.tar.gz`.
The script initializes roles via migrations, restores SQL with error-stop and one
transaction, restores the media volume, then starts web/worker. Reapply the intended
restricted-role password in a private administrative session when restoring to a
new cluster. Never run a second worker against a copied live usage ledger without
reconciling its lock and billing first.

Verify tenant isolation, staff login, known case reference, attachments, queued turns,
worker health and ledger continuity after restore. Record rehearsal date and expiry.
Local container PostgreSQL checks and VPS/Compose/TLS checks are separate evidence;
see [verification-latest.md](verification-latest.md).
