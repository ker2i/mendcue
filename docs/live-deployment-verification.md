# Live deployment verification — November 1, 2026

MendCue's existing VPS now serves HTTPS through Cloudflare Tunnel at
`https://intake.quickfixphx.com`. The web and worker processes use the same PostgreSQL,
private media volume, spending ledger and live Meta credentials. Both process health
checks passed after deployment. Credentials and connection details remain outside
this repository under the operator's private configuration directory.

## Executed live checks

- Tunnel connected to Cloudflare; its published hostname routes to `http://web:3000`.
- Public HTTPS health, corrected iframe URLs, synthetic anonymous session creation
  and one-use session exchange passed.
- Meta model-list authentication passed using the supplied private key.
- Direct, schema-validated Meta extraction returned the supplied synthetic LG washer,
  OE error code, failure to drain and Phoenix ZIP. Minimal-reasoning probe returned
  HTTP 200, `finish_reason: stop`, 420 input and 470 output tokens (283 reasoning).
- Provisioned a separate QuickFIX tenant and private owner login; email delivery stays
  disabled. This tenant uses the existing shared platform database alongside synthetic
  demo tenants. No claim is made of a separate fresh pilot deployment.
- Through the public HTTPS API with the website's Origin header: created a synthetic
  QuickFIX customer session, processed a queued live turn with the separate worker,
  requested review, submitted the request, and confirmed a saved handoff via the
  authenticated QuickFIX owner's inbox. Assessment status was `ok`. The private
  smoke result retains the case reference; no actual customer data was used.

These are live text integration checks, not evidence of diagnostic accuracy or
measured time savings. AI photo reading remains gated by image-billing review;
manual appliance identity entry remains available. SMTP and real inbox receipt
are not configured or verified.

## Compatibility fixes

The inherited adapter sent `mode: Standard`; the first live completion returned
HTTP 400. Removing that undocumented field allowed HTTP 200. That response exhausted
its fixed 2,048-token generation budget without producing valid JSON. Explicit
`reasoning_effort: minimal` then produced valid schema output within that same budget.
Applied both fixes to the shared adapter and deployed rebuilt web/worker images.
Added regression assertions for the documented request fields. References:
[chat parameters](https://dev.meta.ai/docs/protocols/chat-completions) and
[structured output](https://dev.meta.ai/docs/structured-output).

The first failed call's original ledger was backed up privately. Its full original
$0.10 probe cap was charged conservatively against the shared estimated spend ledger,
with an audit note preserving the HTTP 400 and invoice uncertainty; no spend was
removed to restore budget. Subsequent probes record provider-reported tokens.
The application retains an estimated global cap no higher than $2 and $0.50 per case;
these are local controls, not provider billing limits. No live call was made without
a bounded spending gate.

## Local verification and website handoff

- `npm test`: 102 passed, 1 container-only check skipped (17 files).
- `npm run typecheck`, `npm run build`, `git diff --check`: passed.
- Prior website integration verification: 12/12 QuickFIX browser checks and 41/41
  existing product browser checks; those browser runs used fixtures, not live Meta.
- Generated the enabled public website configuration from the provisioned tenant.
- Rebuilt `quickfix-website-upload.zip` from static website files only and verified
  that it contains the public configuration and no supplied Meta credential.
  Copied the ZIP into Windows Downloads for the existing Cloudflare Pages project.

The static website update still requires uploading that ZIP to its existing Pages
project. No Cloudflare Pages account credential was supplied, so no Pages deployment
was performed here. The live hosted intake is available at
`https://intake.quickfixphx.com/business/quickfix-phoenix` in the meantime.
