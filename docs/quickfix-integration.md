# QuickFIX website integration

The actual QuickFIX page loads MendCue's existing intake widget. Customers describe
an appliance issue, provide contact/location details and optionally a label photo,
review their request, then submit an immutable brief to the technician inbox.
This is the product backend, not the separate scripted `demo-site/` walkthrough.

`quickfix-site/mendcue-config.json` contains public connection settings only. It
ships disabled until the backend has its real tenant and working HTTPS. The phone
links work independently. Closing/reopening chat keeps the existing iframe and
conversation; an unavailable connection offers a retry.

## Current private VPS

Connection details are in `~/.config/mendcue/vps-access.txt`, outside this repository.
The existing `~/mendcue-fixture` installation has healthy web/worker/PostgreSQL, two
synthetic tenants, fixture inference and a localhost-only web port. It has no public
HTTPS endpoint or configured live Meta key. Do not publish that seeded database for
real intake. Use a separate Compose project/database for the real pilot; keep the
fixture installation available for synthetic tests.

## Activation after credentials are available

1. Choose the backend hostname, for example `intake.quickfixphx.com`.
   This is separate from the static Cloudflare Pages site at `quickfixphx.com`.
   On the observed gateway-backed VPS, inbound IP routing is unverified. An optional
   outbound Cloudflare Tunnel is provided in `compose.tunnel.yaml`.
   Follow [Cloudflare's tunnel setup](https://developers.cloudflare.com/tunnel/get-started/),
   route the hostname to **HTTP `web:3000`** in the Compose network, and store its
   token privately as `CLOUDFLARE_TUNNEL_TOKEN` in the backend `.env`.
   See [token handling](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/).
2. Prepare a fresh backend directory and copy the app source, Dockerfile, migrations
   and Compose files there, excluding `.git`, `.env`, `node_modules`, `data`, local
   browser binaries and private artifacts. Copy `.env.example` privately and fill
   its passwords/secrets. Set `APP_BASE_URL=https://intake.quickfixphx.com`,
   `MODEL_PROVIDER=live`, `MODEL_API_KEY` and an intentional spend cap. Keep web and
   worker on the same SQL/media/usage ledger. Leave image billing gated until reviewed.
   Set `COMPOSE_PROJECT_NAME=mendcue-quickfix` to isolate the existing fixture volumes.
3. Build/migrate using the base Compose file. Rotate the newly created restricted
   database role's initial password as described in `deployment.md`, and match
   `APP_RUNTIME_PASSWORD`. Do not run the synthetic seed service in this project.
   With a tunnel, use:

   ```bash
   docker compose build
   docker compose up -d postgres migrate
   # Complete the documented runtime-role password rotation before starting callers.
   docker compose -f compose.yaml -f compose.tunnel.yaml up -d web worker cloudflared
   ```

   Start only the named services so Caddy does not bind ports for the tunnel setup.
   If using direct inbound HTTPS instead, use the existing Caddy path in `deployment.md`.
4. Copy `docs/quickfix-tenant.example.json` to a private file. Replace the public key
   with `pk_` plus a random value, confirm the website-derived business name/phone,
   set owner contact, service ZIPs, privacy wording and notification preferences.
   `serviceZips: null` means area coverage has not been configured, so no unsupported
   ZIP exclusion is made. Provision a private owner account with the existing
   operator CLI and a 16+ character password via stdin (see `deployment.md`).
   For a container, pass the private tenant JSON via a read-only mount, set the
   migration owner's `DATABASE_URL` inside the operator process, and pipe only the
   password to stdin. No public signup or default technician password is needed.
5. Confirm `/healthz` reports `provider: live`, `database: postgres`, `durable: true`,
   and worker health is passing. Run a capped synthetic text case and then a photo
   case only when image billing is enabled. HTTP health alone does not prove inference.
6. On this checkout, after `npm run build`, generate the public website settings:

   ```bash
   node scripts/connect-quickfix.mjs https://intake.quickfixphx.com /private/quickfix-tenant.json
   ```

   This validates the tenant, exact backend HTTPS origin and website origin allowlist.
   It copies only `enabled`, `backendOrigin` and `publicKey`. Re-upload the contents
   of `quickfix-site/` to the existing Cloudflare Pages project. The published site
   requires no server secrets. If the Pages project uses custom security headers,
   allow the backend origin in `script-src`, `connect-src` and `frame-src`.
7. From `https://quickfixphx.com`, create one synthetic request, review and submit it,
   then sign into the provisioned tenant at `/staff` and confirm its brief and photo.
   Test phone width and an unavailable backend. SMTP is optional; inbox delivery works
   without it. Verify real email receipt separately if SMTP is enabled.

To disable new chat entry points, set `enabled` to `false` in the public JSON and
republish the static site. This does not delete submitted requests or existing sessions.

## Local verification

```bash
npm run build
node scripts/quickfix-browser-acceptance.mjs
```

The harness serves the actual QuickFIX HTML/JS on one origin and the backend on a
second origin. It injects only synthetic fixture configuration, tests failed-session
retry, bootstrap, fixture labeling, close/reopen, reviewed submission, authenticated
technician inbox delivery, a 320px viewport and disabled configuration. It uses a
temporary in-memory store/media directory and cleans up servers/browser on exit.
It does not touch VPS data or call Meta. The real public config stays disabled.
