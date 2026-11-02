# Website and API integration

Deploy the backend and provision a tenant using [deployment.md](deployment.md)
first. The backend and the business website can use different hosts.

## Hosted intake link

No JavaScript integration is required for the hosted page:

```html
<a href="https://intake.example.com/business/YOUR-SLUG">Request appliance service</a>
```

The platform's own hosted origin is allowed automatically. The tenant determines
branding, service area, intake fields, privacy wording, and routing.

## Embed the widget

Add each actual website origin to the tenant's `allowedOrigins` before provisioning,
for example `https://example.com` and `https://www.example.com`. Origins must match
exactly and have no path or trailing slash. The public widget key identifies the
business; it does not authorize access to staff or case records.

```html
<script
  src="https://intake.example.com/widget/v1.js"
  data-public-key="pk_YOUR_PUBLIC_WIDGET_KEY"
  data-mode="launcher"
  defer></script>
```

If your website sends a Content Security Policy, allow the backend in `script-src`,
`connect-src`, and `frame-src`. The intake runs in an iframe; transcripts and photos
are not included in host-page events. See [the embed example](../examples/integration/embed.html).

Never put a Meta key, staff password, service credential, or tunnel token into HTML,
static JSON, a browser bundle, or an iframe URL.

## Included QuickFIX website connector

`quickfix-site/` is the public business website code. Its
`mendcue-config.json` contains only public connection settings. No account credential
is needed to serve those static files. To connect your authorized QuickFIX deployment,
use a private completed tenant configuration and the built connector:

```bash
npm ci
npm run build
node scripts/connect-quickfix.mjs https://intake.example.com data/tenant.json
```

The connector validates the HTTPS origin, tenant schema, public key, and QuickFIX
website allowlist, then updates `quickfix-site/mendcue-config.json`. Publish the
contents of that directory to the static site's host. Backend deployment is separate.
The generated configuration enables new widget entry points; setting `enabled` to
`false` and republishing disables those entry points without deleting existing cases.

For other business websites, use the generic embed snippet above rather than the
QuickFIX-specific connector. The checked-in public website settings describe the
public integration; private deployment configuration belongs outside the repository.

## Verify the complete connection

1. Open the real website and launch intake at desktop and phone widths.
2. Use a synthetic complaint and contact details. Review, edit, then submit.
3. Sign into `/staff/?business=YOUR-SLUG` with a private owner account.
4. Find the same reference and verify its saved brief, uncertainty, and any attachments.
5. Close/reopen the widget and reload during an unfinished intake to check recovery.
6. Check a failed connection offers retry and an independent contact option.

The local QuickFIX check serves its website and a synthetic backend on separate
origins. It uses temporary storage and does not call Meta or your deployed database:

```bash
npm run build
npm run quickfix:test
```

Chrome/Chromium is required; `CHROME_BIN` overrides discovery. Fixture checks verify
integration mechanics. Verify live inference separately using the deployment guide.

## Server-to-server API

See [openapi.yaml](openapi.yaml). The integration routes use private bearer service
credentials with explicit scopes:

| Endpoint | Scope |
| --- | --- |
| `POST /api/v1/integration/sessions` | `sessions:write` |
| `GET /api/v1/integration/cases/{caseId}/handoff` | `handoff:read` |

Service credentials are operator-managed tenant records in `service_credentials`;
store the SHA-256 token hash, not the plaintext token. There is no public signup or
credential-issuance endpoint. Staff sessions, public widget keys, and service keys
have different purposes. Keep service requests on your server; these APIs do not
provide browser CORS access. The session-creation response includes a case-scoped
customer token, which must also be handled as a credential.

## Signed webhooks

Endpoint registration is operator-managed in `webhook_endpoints`. Use an authorized
public HTTPS receiver and a separately generated shared secret. Receivers verify
`x-intake-signature` over the exact timestamp and raw body, using HMAC-SHA256;
check timestamp freshness, deduplicate `event_id`, and handle per-case `seq` ordering.
Deliveries are at least once. Stable event identities and persisted retry progress
do not guarantee a receiver sees only one request.

[receiver.mjs](../examples/integration/receiver.mjs) is a local mock, with published
synthetic defaults. Its deduplication is in memory and its minimal verifier is not a
production replay-protection implementation. Configure real secrets only on servers,
and use durable deduplication and timestamp validation in your production receiver.

Failed processing and delivery can be inspected in staff **Settings → Background
delivery and processing**. Authorized staff can request bounded retries. Actual
email receipt and customer communications require separate configured integrations.
