# Supervised pilot and demonstration smoke checklist

1. Build and migrate with the owner role; start web/worker with the restricted role,
   shared SQL/media/ledger, explicit provider mode and private configuration.
2. Confirm `/healthz` reports PostgreSQL/durable storage and the worker's polling
   health is current. These checks must not issue inference requests.
3. Provision a private tenant/staff user with stdin password; check correct-tenant
   login and cross-tenant denial. Test password rotation/revoked sessions.
4. From its hosted URL or allowed-origin widget, enter a synthetic complaint,
   upload a permitted synthetic photo, correct/confirm identity, review and submit.
   Confirm queued/failed states and reload continuity. Try keyboard operation,
   320px and zoom, including staff phone layout; record actual browser evidence.
5. Restart web/worker/PostgreSQL with queued turns; verify one immutable handoff,
   private staff photo, missing facts, review correction and separate identity verification.
6. Confirm notification status, test receiver delivery and bounded retry. Real SMTP
   acceptance/inbox receipt and real Meta calls require separate evidence.
7. Pause/resume active review, hide the tab and return; distinguish measured time
   from manually entered seconds. Preserve the original submitted snapshot.
8. Capture matching quiescent SQL/media backups, restore into an isolated project,
   and recheck staff login, known reference, attachments and usage accounting.
9. Exercise retention only on synthetic expired cases, active/foreign cases and
   retryable file deletion. Inspect failed jobs without publishing private payloads.
10. Generate synthetic paired complete briefs before collecting 5–10 anonymized
    technician cases. Keep repair outcomes withheld. Never present fixtures or
    synthetic grades as inference, pilot accuracy or business savings.

For a reproducible synthetic demo, use explicit local fixture mode with no SQL and
synchronous turns (deployment.md). The seed contains synthetic tenants and example
knowledge only. Restarting this memory process resets its cases; use a dedicated
media directory and remove it only after stopping the isolated demo. Never reset a
pilot database to prepare a demo. The separate static `demo-site/` remains scripted
and requires its own browser check; it is not the running intake application.
