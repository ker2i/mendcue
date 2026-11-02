# MendCue Technician

The technician workspace at `/staff/` is an Android-first, installable web app.
The existing eight-hour sign-in, tenant permissions, private photos, immutable
customer handoffs and review controls remain in use. `/staff#case=...` redirects
to the canonical URL while retaining its fragment.

## Technician use

Open `https://intake.example.com/staff/?business=YOUR-SLUG` in Android
Chrome and replace the hostname/slug, and sign in with your provisioned owner account. Tap **Install app**, or use
Chrome's **Add to home screen / Install app** menu when a prompt isn't available.
Use **New requests**, **Active jobs** and **All requests** to manage the inbox;
search and Load more operate on bounded server summaries.

Open a submitted request and choose **Book an appointment**. Both dates/times use
the business timezone (for example, America/Phoenix), independent of the phone or VPS
clock. Choose a technician, start/end time, visit note and optional reminder. Visits
must be future, within one year, and last 15 minutes–12 hours. Overlapping active
visits for the same technician are rejected atomically, including concurrent saves.
Back-to-back visits are allowed. Save changes to reschedule; **Cancel appointment**
frees the slot. Closing/cancelling a job through the app also cancels its appointment.
Calendar offers day/week views, Today, Previous and Next. This is the internal
schedule; booking does not send a customer confirmation or create a Google Calendar
appointment. Call/email actions appear only for usable recorded customer contacts.
Directions require a recorded full address; neither contact nor address is invented.

**Job notes** are append-only and separate from the customer's original brief.
Appointment, note and quick workflow writes carry stable mutation IDs; server receipts
are atomic with the write. An identical retry after a lost response returns the saved
result. Changed input or stale revisions require explicit review; actions are never
replayed automatically in the background. Existing advanced review/identity/timer
controls retain their previous version checks and workflow semantics.

Unfinished author-entered fields are stored in IndexedDB under the authenticated
tenant/user/case, for up to 24 hours, at most 20 records / 256 KiB total. They are
restored only after session validation. The UI distinguishes device drafts from
server saves. Storage failure leaves edits in the open screen only; online saves
remain usable. Logout clears this account's drafts, private UI and current device
notification binding. **Settings → Clear unsent drafts** removes local draft records.

The service worker scope is `/staff/`. Its cache allowlist contains only versioned
public CSS/JavaScript, icons and a generic offline page. Private API data, photos and
inbox responses are never cached. A cold offline launch asks the technician to
reconnect; there is no offline job download or background edit synchronization.
Updates wait for an explicit **Update app** action after pending draft writes.

## Phone notifications

**Settings → Enable notifications** is opt-in. Notifications cover new briefs and
optional appointment reminders; their lock-screen text contains no customer details.
Tap an alert to open the authenticated request. Session expiry/revocation suppresses
notification eligibility. Sign in and reconnect device notifications after eight
hours; this app does not silently extend a staff session. A provider accepting a
push is not proof of phone display, human review or appointment confirmation.

New-brief target snapshots are queued in the same transaction as submission, in
batches of ten devices with durable per-recipient progress. Retry skips successful
recipients. Provider 404/410 disables the registration. Bounded retries/lease fencing
use the existing worker. Alerts expire after one hour. Reminder jobs capture the
appointment revision; rescheduling/cancellation suppresses obsolete reminders.
Reminder eligibility is checked at delivery, and requires a valid signed-in binding.

Server settings: `PUSH_ENABLED=1`, a persistent matching `VAPID_PUBLIC_KEY` and
`VAPID_PRIVATE_KEY`, and a `mailto:` `VAPID_SUBJECT`. Keys are private operator
configuration; only the public key is returned to the browser. Keep the pair across
restarts. Rotation requires browser re-enrollment. Push destinations are restricted
to exact FCM/Mozilla/Apple provider hosts over HTTPS with no credentials/custom port;
key material and DNS socket destinations are validated, redirects are not followed.
Device enrollment is capped at five active registrations per user. Logout revokes
this session's bindings; provider-accepted notifications cannot be recalled.

Physical Android installation, locked/background delivery, tapping an actual push,
permission denial and weak-reception use require a real-device smoke check. Browser,
SQL and fake-sender tests alone do not establish those device results.

## Deployment and validation

Migration `009_technician_app.sql` adds tenant-scoped appointments and private push
registrations, composite ownership relationships and unique mutation receipts.
Apply with the migration/owner role before starting the updated web/worker. Keep a
private PostgreSQL backup. Historical migrations and submitted snapshots are unchanged.
Both processes require the same push environment; no new model calls are required.

Commands: `npm run typecheck`, `npm test`, `npm run build`,
`node scripts/technician-browser-acceptance.mjs`, existing browser suites, and
`TEST_POSTGRES_URL=<dedicated local test DB> npm test -- tests/pg.integration.test.ts`.
Actual PostgreSQL results must be recorded separately from PGlite and fake push.

References: [service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers),
[Web Push sender](https://github.com/web-push-libs/web-push),
[Push API](https://www.w3.org/TR/push-api/).
