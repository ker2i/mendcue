# QuickFIX integration verification — October 31, 2026

Implemented the connection from the existing repairman's static website to the
existing MendCue intake backend and technician inbox. The separate marketing demo
and prior uncommitted technician changes were preserved.

Changes:

- Public JSON connection settings, a conditional repair-request button and branded
  widget launcher. Disabled/missing/invalid settings keep phone contact available.
- Widget loading/timeout/retry feedback, accessible close/reopen controls, retained
  iframe session, focus restoration and a 320px-compatible floating panel.
- QuickFIX tenant template using the business name/phone already on the website;
  service ZIPs remain unconfigured pending owner input. No synthetic knowledge or
  existing demo staff account is copied into the template.
- Connection CLI validates tenant schema, website allowlist and exact HTTPS origin,
  then emits only three public settings; the Meta key stays on the backend.
- Optional Cloudflare Tunnel Compose overlay and an activation runbook. No tunnel
  credential has been installed and no DNS or Cloudflare Pages deployment was changed.

Executed:

- Baseline application suite: **102 passed, 1 container-only test skipped** across
  17 files, using fixtures with inherited database/model credentials removed.
- Build/typecheck, JS syntax and whitespace checks passed.
- Existing product browser acceptance: **41/41 passed**. Updated its staff navigation
  to wait for DOM readiness and its reload check to use the existing automatic
  session restoration rather than trying to log in a second time.
- Actual QuickFIX page browser harness: **12/12 passed**. Covers a failed session
  followed by retry, cross-origin bootstrap, fixture labeling, credential-free iframe
  URL, close/reopen continuity, reviewed submission, authenticated technician inbox,
  320px panel fit, disabled configuration and no browser JS errors.
- Connection CLI exercised in a temporary directory: public-only output; rejection
  of HTTP/path/trailing-slash origins and missing website allowlist passed.
- Base + tunnel Compose configuration validated with placeholder values in a private
  temporary directory. No real secret was printed and no tunnel was started.
- Read-only SSH inspection confirmed the existing VPS fixture web/worker/PostgreSQL
  were healthy. `/healthz` reported fixture inference and durable PostgreSQL.

The QuickFIX test uses temporary memory/media with synthetic customers and fixture
responses. It proves integration mechanics, not live Meta quality, time savings,
real technician use, email delivery or persistence across a deployed restart.
The public website configuration remains disabled, as requested while credentials
are arranged. Live Meta and HTTPS/tunnel activation, real tenant/staff provisioning,
and publishing the updated static folder remain for that next step.
