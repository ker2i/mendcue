# MendCue technician phone app — implementation specification

Current implementation (November 1, 2026): see [technician app](docs/technician-app.md) and its verification record. The specification below is the earlier planning baseline; the user subsequently added real scheduling to scope.

Prepared October 31, 2026 against `2be5d97` in `ker2i/mendcue`.
Status: **approved direction, proposed implementation; no app features below are
claimed implemented unless listed under the current baseline.**

## 1. Product decision

Build an Android-first, installable progressive web app (PWA) around the existing
staff workspace. Keep the Express/TypeScript, PostgreSQL, worker and tenant
architecture. Use the existing intake and brief generation; this is the technician
companion, not a second customer intake application.

The repairman is usually at a customer's property or travelling between jobs. The
primary journey is **new brief notification → tap → inspect the brief/photos →
contact the customer or record a decision**. Opening the home-screen icon should
restore a valid sign-in and show the inbox without entering the business slug again.

Deliver the browser version and installable version from the same application.
Android Chrome is the initial device target. A native APK/Play Store release and
dedicated offline job management are later decisions based on actual field use.
Installation and notification availability must be detected, not assumed. See the
[manifest guidance](https://web.dev/learn/pwa/web-app-manifest) and
[Android installation guidance](https://web.dev/learn/pwa/installation).

## 2. Current baseline and gaps

Already present:

- `/staff` workspace, tenant/staff login, eight-hour server sessions, HttpOnly
  cookies, CSRF checks, tenant-scoped APIs and a server-enforced read-only role.
- Submitted immutable briefs, private photos, facts/transcript/source evidence,
  workflow updates, append-only technician corrections and identity verification.
- Actor-scoped active review timer; background/Settings pauses, draft preservation
  during timer/verification actions, saved correction fields restored on reload.
- PostgreSQL/memory stores, transactional case/outbox commits, bounded retries,
  lease fencing, delivery diagnostics, private SMTP notification and retention.
- Staff/intake browser reflow checks at 320px and a shared Linux/WSL Chrome launcher.

Missing for this app:

- The client always starts at the login form, even while its server cookie is valid.
  Login JSON currently has no stable user ID; there is no session-restore/logout API.
- No manifest, scoped service worker, home-screen installation or Web Push support.
- The desktop inbox and detail are shown together; phone navigation needs a list
  screen and a separate detail screen with predictable Back behavior.
- Notes are not durably preserved across a page/process restart. API data/photos
  currently have no comprehensive policy suitable for a private PWA cache.
- The inbox API returns all cases and reads their facts individually. A mobile
  inbox needs bounded summaries, filtering and pagination.

Current verification is documented in [docs/verification-latest.md](docs/verification-latest.md).
Its counts are historical until rerun in the implementation session: 101 application
tests plus one container-only skip, 41 product browser checks, 22 local static-demo
checks, 12 actual PostgreSQL checks and six synthetic PDF checks.

## 3. MVP scope

| Required for MVP | Deferred |
| --- | --- |
| Restore a valid session; explicit logout | Longer-lived trusted-device authentication, biometrics |
| Phone inbox, brief, photos and existing review/status controls | Dispatch assignment, calendar/route planning, GPS tracking |
| Installable shell and a clear offline screen | Native Android/iOS projects, app-store submission |
| Opt-in new-brief push notifications with direct case opening | Customer chat/SMS, repeated reminders, marketing notifications |
| Recover unfinished text; explicit reconnect and conflict handling | Background replay of edits and full offline brief/photo downloads |
| Preserve existing staff permissions, evidence and safety labels | Payments, parts ordering or autonomous diagnosis |

No new model call is needed for viewing, formatting, searching, installing or
notifying. Keep runtime inference Meta-only and existing spend controls unchanged.
Do not add Firebase project setup, another queue server or a framework rewrite as
a prerequisite. Standard Web Push can use the browser's push service and VAPID;
the existing worker handles sending.

## 4. Screens and interaction

### Entry, sign-in and installation

Use `/staff/` as the canonical app URL. Keep `/staff` and existing
`/staff#case=CASE_ID` links working, including the fragment after canonicalization.
Keep the stable `#case=UUID` detail link format for existing mail and bookmarks.

On entry, show a neutral loading shell and check the server session before showing
private content or the login form. A valid session opens the requested case, or the
inbox. A failed network request shows reconnect/retry, not “wrong password” or an
empty inbox. Expired/revoked sessions show sign-in and preserve the intended case.

Allow a public business slug hint in the entry link and remember the last slug as
a convenience. It is never an authorization source. Retain operator provisioning;
no public registration or new demo users in a real tenant.

Provide “Install on this phone” when supported, after the user reaches the app.
If an install prompt is unavailable, show browser-specific manual guidance; keep
normal browser use available. Do not repeatedly interrupt with install prompts.

### Inbox

- Header: business name, connection state, account/settings and refresh.
- Filters: **New**, **Active**, **All**. Default to submitted New requests. Active
  includes new/reviewing/contacted/scheduled; All includes closed/cancelled briefs.
  Customer drafts are not new service requests; retain an explicit draft view for
  existing staff workflows if needed.
- Each item: reference, appliance/available brand and model, short complaint, service
  ZIP/area, submitted time, workflow and safety labels. Unknown identity stays unknown.
- Search reference, appliance, complaint or ZIP. Bound the server result; use a
  clear “Load more” action. Distinguish loading, no requests, no matches and failure.
- Show urgent safety labels prominently without turning notification delivery into
  an emergency-response promise. Use text as well as color.
- Opening a case preserves inbox filter, loaded rows and scroll position for Back.
  Refresh on foreground/reconnect without replacing a dirty detail form.

### Brief detail

At phone widths, show one case and a visible Back-to-inbox control. Browser/Android
Back should follow the same navigation; refresh/relaunch should reopen the case.

First screenful: reference, safety state, appliance identity/provenance, complaint,
service area and the primary next action. Then show key observations, missing facts,
preliminary issue areas, recommended follow-up and documentation coverage.

Keep customer statements, AI suggestions and technician verification distinguishable.
Retain original submitted evidence and show later corrections as separate revisions.
Photo thumbnails open an authenticated viewer with an obvious close/Back action.
Expand transcript, citations and operational details on demand.

Provide Call/Email only when a usable customer contact is actually recorded. The
current `contact.channel` is free text and may hold an email, telephone or preference;
do not assume every value is dialable or confuse it with the business's own contact.
Validate/normalize a contact value or add structured derived fields before generating
`tel:`/`mailto:` links. Never invent a customer address, phone or directions target.

Retain review decisions **Ready to contact**, **Need information**, **Urgent human
review** and workflow updates **Reviewing**, **Contacted**, **Scheduled**, **Closed**,
**Cancelled**. A status change is not a sent message, phone call or calendar booking.
Keep safety status editing deliberate and separate from routine workflow shortcuts.

Keep identity verification, corrections, missing facts, unsupported assertions and
timer controls available. Never auto-start/resume a review timer on notification
open, foreground or reconnect. If a background/offline pause cannot be confirmed,
label timing uncertain and prevent treating the uncertain interval as measured
effort until explicitly resolved. Any interval exclusion must be append-only and
server-derived; do not backdate a pause using client wall-clock time.

### Settings

Show the signed-in business/user, notification state for this device, install help,
local unsent-draft controls, app version and logout. Existing operational settings
remain accessible to staff under their current permissions. Keep setup internals
and raw subscription/provider errors out of the technician's normal workflow.

Use at least 48 CSS-pixel primary touch targets, readable 16px inputs, visible focus
states and labels. Support 320px reflow, browser text enlargement/200% zoom, keyboard
use, screen readers, reduced motion and the Android soft keyboard. Bottom actions
must not cover text or focused fields. Preserve the desktop workspace.

## 5. Authentication and session lifecycle

Keep the current eight-hour absolute session lifetime for MVP. Fix restoring an
existing session before considering longer-lived authentication. Never persist
passwords, session IDs or bearer tokens in localStorage/IndexedDB/URLs.

Proposed additive contracts, finalized in `docs/openapi.yaml` during implementation:

| Endpoint | Contract |
| --- | --- |
| `GET /api/v1/staff/me` | Authenticated `{user:{id,name,email,role},tenant:{id,slug,name},expiresAt,csrf}`; `401` when expired/revoked. No password/session ID. |
| `POST /api/v1/staff/logout` | CSRF-protected revocation of the current server session and its push binding; clear cookies. Safe local logout behavior when already expired. |
| Existing login | Preserve current consumers; add stable user/tenant identity and expiry for the new client. |

Restore must validate current user membership/role, not trust cached account metadata.
CSRF recovery may issue a fresh CSRF cookie only after authenticating the server
session. Recheck on foreground and before sending after a connection interruption.
Distinguish `401` session expiry from `403` permission failure.

Logout clears rendered private state, this account's local drafts and device push
binding; notify other open staff tabs to clear their state. Reject late responses
from the previous account after logout/account change. Password rotation/revocation
continues to invalidate sessions and makes their push bindings ineligible.

All authenticated staff JSON and photos should use `Cache-Control: no-store` in
this app. Audit the existing photo `private, max-age=60` policy. The service worker
must not override the private-data policy by caching these responses itself.

## 6. Weak connectivity, drafts and safe writes

MVP is online for reading fresh briefs and saving server changes. An open detail may
remain visible in memory with a last-refreshed time while reception drops. A cold
offline launch shows the generic app shell and reconnect guidance; it must not
pretend to have downloaded a full inbox or photos.

Preserve unfinished author-entered review/note/verification text and dirty-field
state. Use bounded IndexedDB records keyed by tenant ID, user ID, case ID and form
kind, including base case version, mutation ID, created/updated timestamps and expiry.
Store only the author-entered fields needed for recovery, not complete API responses,
transcripts, contact lists or images. Text may itself contain private information;
explain that unfinished notes are stored on this phone and provide Clear drafts.

Use a 24-hour maximum lifetime from draft creation, max 20 drafts/256 KiB total,
and enforce existing server field limits. Expire records on access/startup; handle
storage failures with an honest “kept in this open screen only” state. Never evict
an unexpired unsent draft silently to make room. These are proposed product limits,
not existing implementation facts.

Restore stored text only after online session validation confirms the same tenant
and user. An expired session can leave a quarantined draft until the same user signs
in within its TTL; never show it on the login screen or to a different account.
MVP need not unlock private drafts after a cold offline start. Explicit logout clears
them. Remote revocation cannot guarantee immediate erasure on a disconnected phone.

Represent editing/sending states explicitly:

| State | Expected behavior |
| --- | --- |
| Editing / saved on this device | No claim of server persistence; protect text across navigation/reload. |
| Sending | Disable duplicate submission; preserve the draft until the result is confirmed. |
| Saved | Server acknowledgement or matching committed mutation receipt; clear the corresponding local draft. |
| Connection lost / outcome unknown | Keep text and mutation ID; reconcile with the server before retrying. |
| Case changed (`409`) | Preserve local text; show current server revision and let the user reconcile/reconfirm. No silent overwrite. |
| Session expired | Ask for sign-in, retain a quarantined draft and intended case under the rules above. |

Use existing compare-and-swap case versions. New mobile business writes should
include a UUID `clientMutationId`. Persist an atomic, tenant/user/case/operation-bound
receipt with the business event and case change, so retrying an identical request
after a lost response returns its original result without another review, timer
event or webhook. Reject reuse of an ID with different input. Both stores must agree;
extend `CaseCommit` if needed. Retain receipts for at least the 24-hour draft window,
and remove them with the case. Preserve existing API compatibility for older callers.

Add `GET /api/v1/staff/cases/:caseId/mutations/:clientMutationId` for authenticated,
owner-scoped reconciliation: return the committed operation/result and its original
case version, or `404` for no visible receipt. An absent receipt does not prove that
an in-flight request failed. An explicit identical retry retains the same ID and
body; a reconciled, deliberately changed action gets a new ID and current version.
Atomic uniqueness must also handle two identical requests arriving concurrently.

Reconnect may refresh/check receipts automatically; it must not automatically submit
an unconfirmed edit or replay workflow/review/identity/timer actions in the background.
No Background Sync requirement for MVP. Do not infer connectivity solely from
`navigator.onLine`; use actual request outcomes.

## 7. Installation and service worker boundaries

Manifest proposal: `id`, `start_url` and `scope` are stable `/staff/`; name
`MendCue Technician`, short name `MendCue`, display `standalone`, existing brand
colors and real 192/512px app icons plus a maskable variant. Do not put user IDs,
tenant IDs or auth tokens in the manifest's identity/start URL. Do not require an
orientation lock or hide normal browser access.

Serve `/staff/sw.js` with scope `/staff/` and a generic offline shell. Do not install
a root-scoped worker controlling `/embed`, `/widget`, customer intake or the separate
static `demo-site/`. Scope needs care because the existing `/staff` URL has no trailing
slash. Verify canonical/legacy links rather than broadening worker scope to `/`.
Worker scope and lifecycle rules are described in
[MDN's service worker guide](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

Cache only an explicit allowlist of same-origin, versioned public shell assets,
icons and generic offline HTML. Never use a catch-all cache-first rule or cache
staff/customer APIs, errors, attachments, private exports, login or logout responses.
Use explicit content types and retain the existing restrictive CSP, adding only
the directives required for same-origin workers/manifests.

Use a versioned cache and controlled update flow. Announce “Update ready” and apply
after drafts are persisted and the user accepts; do not forcibly reload a dirty form.
Clean old app caches safely and keep IndexedDB draft schema migrations separate.
Use HTTPS in production; localhost is suitable for local worker development. A real
phone accessing a plain HTTP LAN IP is not equivalent to a secure-origin install test.

## 8. New-brief Web Push

### Opt-in and delivery contract

Offer notifications only after sign-in and an explanatory user action. Subscribe
with `userVisibleOnly: true` and the VAPID public application-server key; the private
key remains server-side. See
[PushManager.subscribe](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe).

MVP sends one logical new-brief event per successfully committed submission/handoff
to active opted-in staff devices in that tenant. Include all existing staff roles
that may read the brief; personal notification settings do not grant case mutation
rights to read-only staff. No alerts for draft messages, photo uploads or ordinary
status edits. Opening a brief does not send a read receipt to the customer.

Bind each subscription to the authenticated tenant, user and current server session.
For MVP it remains eligible during that eight-hour session even when the app is
closed. On session expiry, show “Sign in to reconnect notifications” on next open
and require reauthentication/rebinding. Do not silently extend sign-in through push.

Default visible notification: **MendCue — New service brief. Open the app to review.**
Keep customer name, telephone, address, complaint, image and safety details out of
the visible notification and push payload. Payload may contain an opaque event ID,
case UUID, version/type and expiry. Generate only the validated local case target.
Use a consistent notification tag for the event to reduce duplicate alerts.

Click should focus a suitable existing staff window or open `/staff/#case=UUID`.
Authenticate and authorize before loading the case. If signed out, preserve the
target through login; if unavailable/foreign/deleted, show a neutral unavailable
state. Never accept an arbitrary URL from push data or execute workflow mutations
from notification buttons. Show notifications from the service worker using
[showNotification](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification).

Notification state must distinguish unsupported, not enabled, browser permission
blocked, connected to this account, and needing reconnection. Do not repeatedly ask
after denial. Provide disable and a deliberately rate-limited “Send test notification”
using the same sender. Test notifications are synthetic and contain no case data.

### Server, queue and storage

Proposed endpoints, all staff-authenticated; mutations require CSRF:

| Endpoint | Contract |
| --- | --- |
| `GET /api/v1/staff/push/config` | Enabled/capability configuration and public VAPID key; no private key or endpoints. |
| `POST /api/v1/staff/push/subscriptions` | Validate/upsert the current browser subscription; derive ownership/session server-side. Return opaque registration ID/status. |
| `GET /api/v1/staff/push/subscriptions` | Current user's device registration metadata only; never return raw endpoints/auth keys. |
| `DELETE /api/v1/staff/push/subscriptions/:id` | Disable only a registration owned by this user/tenant. |
| `POST /api/v1/staff/push/test` | Send to this session's owned registration; max three requests per hour per user, plus existing request limits. |

Use additive migrations after 008, leaving deployed history untouched. Suggested
tables are `staff_push_subscriptions`, `staff_push_deliveries` and mutation receipts
from section 6. Store subscription endpoint and encryption material privately,
endpoint hash, ownership/session, enabled flag and created/updated/last-success times.
Bound active registrations to five per user; reject overflow with a manageable list.
Do not log subscription URLs, auth secrets, passwords or raw provider responses.

Enforce ownership with RLS/composite relationships and bounded worker helpers, and
mirror behavior in memory. Never grant broad tenant-bypass access to `app_runtime`.
A browser endpoint must not be active for two accounts simultaneously. Do not steal
or silently rebind another account's active registration; logout/revocation followed
by fresh enrollment must create a safely owned binding. Suppress old queued targets
if their session, user, tenant or ownership no longer matches.

Subscription endpoints are untrusted outbound URLs. Validate bounded HTTPS URLs,
subscription keys, ports and a documented push-provider hostname allowlist; reject
credentials, localhost/private/link-local/metadata targets, redirects and DNS-based
bypasses. Revalidate destinations at send time using a transport that actually
enforces the approved destination. Do not merely apply a string prefix check.

Enqueue a distinct `staff_push` job **inside the successful submission transaction**.
Email remains the existing independent `notification` channel. Repeated/concurrent
submission must preserve one logical push event; failure must not lose a submitted
brief or block turns, email or webhooks.

Persist a bounded recipient snapshot/fan-out and unique per-event/subscription
progress before any send. Use registrations eligible at submission time; a new
opt-in must not receive a backlog of old alerts. A retry skips completed recipients,
while rechecking revocation before
each attempt. Use existing retry limits, availability timestamps, lease generations
and bounded operator retries. Do not imply exactly-once display: an accepted send
followed by a crash may be repeated. Provider acceptance is not confirmed display,
opening or human review.

For the pilot, expire undelivered alerts after one hour; stop retries after expiry.
Do not send stale new-brief alerts for a deleted/closed/cancelled case. Disable gone
subscriptions on provider 404/410; retry timeouts/429/5xx with bounded backoff and
applicable Retry-After, and expose other permanent/configuration failures privately.
Bound network timeouts and fan-out so sending does not monopolize the worker lease.
Use a maintained Web Push library rather than writing cryptography; the
[Node Web Push library](https://github.com/web-push-libs/web-push) is a candidate to
verify and pin during implementation.

Proposed shared settings: `PUSH_ENABLED` (default false), `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_ALLOWED_HOSTS`. Validate consistently in
web/worker; enabled with missing/invalid settings must fail clearly without printing
secrets. Retain one key pair across process restarts and document rotation/re-enrollment.
No keys belong in source control or the client bundle except the public key.

Logout disables this session's bindings, attempts browser unsubscribe and closes
existing app notifications. Already accepted provider messages cannot be recalled;
keep them generic. Expired/revoked bindings and diagnostic receipts need bounded
cleanup under the existing retention process; usage accounting remains untouched.

## 9. Implementation order and repository touchpoints

1. Inspect checkout/instructions and rerun baseline checks. Preserve original static
   demo changes; read `NEXT_TECHNICIAN_APP.md` before editing.
2. Add session restoration/logout, expiry handling and safe account switching.
   Then build phone list/detail navigation and bounded inbox summaries. Keep existing
   desktop and legacy links working; verify customer contact parsing.
3. Add draft recovery, safe mutation receipts and conflict/unknown-outcome handling.
   Protect drafts during navigation, foreground refresh, timer changes and updates.
4. Add manifest, icons, scoped worker and generic offline shell with strict cache
   tests. Verify normal browser fallback before installation work.
5. Add subscription ownership/configuration, transactional push enqueue/fan-out,
   sender and notification clicks. Use an injected local fake sender for deterministic
   tests; real push is a separate, explicitly recorded device check.
6. Finish accessibility/phone polish, operator setup, reset/smoke procedure and actual
   verification notes. Complete independent work when real device/domain inputs are
   absent; report the precise unexecuted checks.

Likely files: `src/server/{staff,pages,app}.ts`, `src/server/ui/{staff.js,app.css}`,
new staff-only worker/assets, `src/db/{store,memory,pg}.ts`, new migrations,
`src/domain/{intake,outbox}.ts`, `src/worker/worker.ts`, `src/config.ts`, new push
integration, `.env.example`, Compose, OpenAPI and tests/browser scripts. Keep the
existing dependency-free UI unless a concrete implementation need justifies more.

Update `docs/deployment.md`, `docs/pilot-smoke-checklist.md`, `docs/demo-script.md`
and `docs/verification-latest.md`. Keep synthetic examples visibly synthetic.
Preserve Meta-only inference, safety escalation, private photos, source provenance,
human approval, immutable submitted snapshots and accounting integrity.

## 10. Acceptance and evidence

Implementation is complete when the MVP above is implemented and locally checked;
field readiness additionally requires the real-device checks below. Do not collapse
those two claims or label simulated push as actual Android delivery.

### Automated/local checks

- Valid session reload/relaunch restores inbox or linked case; no login flash/private
  data flash. Expired/revoked/foreign sessions fail correctly; network failure is
  distinct from expiry. Logout/rotation and account switching clear applicable state.
- Read-only staff can read/enroll their own notifications but cannot alter cases.
  Tenant A cannot access B's briefs, photos, receipts, drafts or subscriptions.
- Mobile new/active/all filtering, bounded pagination and search work without
  downloading all transcripts/photos; stable ordering handles equal timestamps.
- Back, deep link, refresh, Android-like navigation and resumed app preserve context.
  Valid contact links work; malformed/free-text contacts do not become unsafe links.
- Dirty forms survive phone navigation, lost connections and reload under the draft
  rules. Storage full/disabled, TTL, logout and different-account recovery are tested.
- Inject response loss after a committed mutation: retry/receipt reconciliation
  yields one business event/outbox effect. True version conflict preserves the local
  draft and requires reconfirmation. No offline mutation auto-replay occurs.
- Timer start/pause/background/account changes preserve draft state; uncertain
  intervals are not reported as measured effort or fabricated time savings.
- Manifest/icons/canonical links work; scoped service worker leaves customer intake
  alone. Inspect Cache Storage/IndexedDB: no cached private API/photo responses.
  Update/reload does not erase unsent text; unsupported/denied APIs degrade gracefully.
- Submission rollback creates no push job. Concurrent/repeated submit creates one
  logical event. Worker restart preserves targets/event/progress; success is skipped
  on retry; expiry, revocation, 404/410, timeout, rate limiting and lease expiry behave
  predictably. A slow/failed device does not block other channels or healthy recipients.
- Untrusted subscription URL/ownership cases are rejected without outbound private
  network access. A fake sender proves mechanics without a real provider request.
- Browser checks cover 320/390px, desktop, actual zoom where available, keyboard,
  focus, soft-keyboard visibility and safe foreground/session refresh. Extend the
  existing suites; run typecheck/build/application tests and actual SQL when available.

### Real Android pilot smoke — record actual results separately

On the technician's Android phone, over a trusted HTTPS origin: install, launch,
restore sign-in, enable notifications and submit a synthetic customer case. With
the app backgrounded/closed, observe the notification, tap into the correct brief,
view a private photo, contact using synthetic details and save a review/status.
Test expiry/login redirect, permission denial, logout, phone lock/unlock and weak
reception. Verify unsent text recovery and no stale cached private brief after
switching accounts. Record OS/browser/version and any device notification settings.

Do not place real customer details in test alerts or make actual customer calls.
Physical-device delivery, app-store availability and offline access must only be
claimed for what was actually exercised. Domain/TLS/business details and device
availability are external inputs, not a reason to fabricate results or stop local work.

## 11. Later offline/native decision

After the phone pilot, consider explicit “Save this brief for a visit” with an
expiry, selected private content, authenticated unlock, storage/removal controls and
separate conflict-safe sync design. Do not quietly expand the service-worker cache
to implement this. Choose a native Android client only when actual requirements
justify its additional distribution, authentication and maintenance work. Reuse
the same tenant-safe APIs and brief semantics whichever client is selected.
