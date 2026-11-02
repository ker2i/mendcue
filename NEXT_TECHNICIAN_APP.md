# Next session — build the MendCue technician phone app

Current implementation (November 1, 2026): see [technician app](docs/technician-app.md) and its verification record. The specification below is the earlier planning baseline; the user subsequently added real scheduling to scope.

Prepared October 31, 2026. Workspace: `/home/zemmli/appliance-intake`.
Repository: `ker2i/mendcue`, `main`, baseline `2be5d97`.

## Request and accepted direction

The owner wants a repairman working at customer sites to receive and inspect briefs
on his Android phone. We agreed to begin with an installable PWA using the existing
staff workspace and backend. The requested specification is complete; implementation
has **not** started in this specification session.

Read [TECHNICIAN_APP_SPEC.md](TECHNICIAN_APP_SPEC.md) for the full product/API,
authentication, draft, installation, push and acceptance requirements.

Target flow: **notification → correct brief → photos/contact → human decision**.
Also make opening the home-screen icon restore an existing valid session and inbox.
Native APK/Play Store publishing and full offline brief downloads are later phases.

## First actions

1. Check current instructions, branch, history and diff. No applicable `AGENTS.md`
   was found while preparing this handoff; check again.
2. Read the spec, `docs/verification-latest.md`, `docs/deployment.md`,
   `docs/architecture.md`, and the staff/auth/store/worker implementation.
3. Preserve the existing uncommitted static demo work. It includes README and
   package.json additions, `.github/`, `demo-site/`, demo browser/preview scripts,
   `docs/demo-site-verification.md`, demo screenshots and `NEXT_IMPLEMENTATION.md`.
   The demo browser script has local WSL portability edits. Do not reset, discard,
   stage broadly or accidentally publish these files. The two technician spec/handoff
   files are new documentation from this session; retain them too.
4. Run the current baseline, then implement in coherent increments using the
   sequence in spec section 9. Record actual results; old counts are not fresh tests.

```bash
npm test
npm run typecheck
npm run build
node scripts/browser-acceptance.mjs
# The following script/package entry currently belongs to preserved local demo work:
SCREENSHOT_DIR=/tmp/mendcue-demo-verification npm run demo:test
```

The browser launcher supports Linux Chrome or installed Windows Chrome through WSL;
`CHROME_BIN` overrides discovery. Keep fixture runs explicitly on fixture mode with
no production database or live key. Use temporary screenshots so original images
remain intact. Dedicated actual PostgreSQL tests use the existing guarded
`TEST_POSTGRES_URL` convention; PGlite and fake push are separate evidence.

## Non-negotiable implementation details

- Restore sessions before showing private data; retain the current eight-hour
  lifetime. Add real logout/revocation, stable user IDs and expiry handling.
- Improve the actual staff UI, including phone list/detail/Back behavior. Reuse
  existing review, identity, photo and workflow APIs; preserve the desktop.
- Keep unsent text scoped to the authenticated tenant/user/case. Preserve it through
  failed saves and conflicts; reconcile lost responses using atomic mutation receipts.
  Do not auto-replay actions or claim a locally stored note is saved on the server.
- Scope installation/service worker to canonical `/staff/`, with working legacy
  `/staff#case=...` links. Cache public shell assets only. Offline private brief/photo
  downloads and browser background edit sync are outside MVP.
- Use opt-in Web Push/VAPID through the existing durable worker. Push jobs must
  commit atomically with submission and retain per-recipient delivery progress.
  Subscriptions belong to an authenticated tenant/user/session; validate outbound
  destinations. Keep lock-screen content generic and session expiry explicit.
- Preserve RLS/restricted roles, CSRF, private media, human approval, identity/source
  provenance, immutable handoffs, timer honesty, retention and Meta-only inference.
  No model calls are needed for this mobile app work.
- Check both stores, SQL migrations/rollback, real browser behavior and actual
  PostgreSQL where available. Use a fake push sender locally; mark physical Android
  installation/delivery and HTTPS deployment unverified until actually tested.

The October 31 implementation baseline passed 101 app tests (one container-only
skip), 41 product browser checks, 22 local static-demo checks, 12 actual SQL checks
and six synthetic PDF checks. Full Compose/TLS was not verified: Node image pulls
failed. No real Meta call, real manual review or technician pilot was claimed.

## Copyable prompt

> Read NEXT_TECHNICIAN_APP.md and TECHNICIAN_APP_SPEC.md in
> /home/zemmli/appliance-intake. Implement the technician PWA on the existing
> Express/TypeScript/PostgreSQL/worker architecture. Start with session restoration
> and phone inbox/detail navigation, then safe draft recovery/mutations, scoped
> installation/offline shell, and durable opt-in new-brief push. Preserve the
> uncommitted static demo work and existing safety/tenant/privacy/evidence controls.
> Follow the spec's implementation order and acceptance criteria. Continue local
> implementation/testing when domain/device/push inputs are unavailable and record
> precise unverified checks. Do not build a separate native app, deploy publicly,
> register a domain or fabricate device/pilot/live-inference results.
