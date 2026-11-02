# Technician app verification — November 1, 2026

Built the installable technician web app on the existing Express/PostgreSQL/staff
workspace. Added real appointments, day/week calendar, rescheduling/cancellation,
atomic collision checks, internal job notes, bounded inbox summaries/search,
account-scoped IndexedDB drafts, public-only offline shell, and opt-in Web Push.
Scheduling uses the configured business timezone; it is an internal booking, not
a customer message or external calendar integration.

## Executed local evidence

- Baseline: 104 tests passed, one container-only test skipped.
- Final application suite: **115 passed, one container-only test skipped**, 18 files.
- Build, typecheck, client/worker JavaScript syntax, whitespace and OpenAPI YAML checks passed.
- **18/18** technician browser checks: login/canonical links, session and unsent-note
  recovery, injected response loss after a committed note, exactly one saved note,
  Phoenix appointment persistence, no-reminder preference, day/week calendar,
  cancellation, immutable original brief, 320px reflow, explicit notification setup,
  scoped worker, no private cache, backend-unreachable cold launch/reconnect, logout
  draft/UI cleanup and no browser JavaScript errors.
- **41/41** existing product browser checks and **28/28** QuickFIX website browser
  checks passed with synthetic fixtures. These include customer chat, submission,
  inbox, private images, review corrections, identity verification and timer controls.
- **14/14** SQL tests against an isolated actual PostgreSQL 16 container using the
  restricted runtime role. This is separate from PGlite: atomic concurrent submission,
  concurrent overlapping booking (one success), overlap rollback, appointment rows,
  mutation receipt ownership, bounded inbox search, push ownership/session cascade,
  and retirement of pending reminders were exercised. A local TCP relay worked around
  WSL host-port forwarding; both relay and test container were removed afterward.
- Fake push sender checks covered snapshot recipients, durable successful-recipient
  progress across retry, late opt-in exclusion, session revocation and provider 410.
  Endpoint/key and socket-address validation were checked without external sends.

The browser cold-offline check deliberately stopped its local HTTP server. Chrome's
page-only offline emulation did not reliably make the separate service-worker
network target offline, so it was not counted as offline evidence. Reconnect was
exercised through fresh navigation after the server became reachable again.

## VPS / HTTPS evidence

- Created a private PostgreSQL dump before applying additive migration 009. Preserved
  the pre-change environment in the VPS private configuration directory.
- Built/deployed web and worker. Migration runner reported `009_technician_app.sql`;
  subsequent web/worker health checks passed, along with existing Postgres/tunnel health.
- Generated one persistent VAPID pair in the operator's private configuration; the
  same credentials are configured for web and worker. Secret values were not printed
  or put in repository/static assets. No SMTP or external calendar was configured.
- Using the provisioned owner account and a previously recorded synthetic QuickFIX
  case, the HTTPS browser check opened the real app, booked a visit, replayed the
  identical mutation, found the visit in the phone calendar, cancelled it and restored
  its original workflow. The submitted handoff stayed unchanged. Screenshot:
  `docs/screenshots/technician-live-calendar.png`.
- HTTPS service-worker scope and enabled notification configuration were checked.
  No Meta calls, real customer messages, live push sends or physical phone interactions
  were needed for these app checks. The synthetic visit was cancelled after checking;
  audit events remain recorded.

## Precise device checks still outstanding

Physical Android installation/home-screen launch, browser permission prompts, locked
or backgrounded push delivery, tapping a real notification, device-level notification
settings and field connectivity remain unverified. Enable notifications from Settings
on the actual phone, then use Send test notification and a synthetic request to
complete the device check. Provider acceptance/fake sender success does not establish
display or human review. Sign-in is still limited to eight hours; expired sessions
must sign in and reconnect notifications. Private briefs/photos are online-only.

The app's appointment/note/quick-status writes use atomic receipts. Older advanced
review/identity/timer controls retain their existing CAS/version semantics; they are
not represented here as newly implemented receipt-based mobile mutations. This is a
web app installation, not an APK or app-store publication.
