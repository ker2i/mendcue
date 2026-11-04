# MendCue

MendCue turns appliance symptoms into a service request a technician can review
before a visit. It includes an embeddable website chat, a hosted intake page, a
technician workspace with internal scheduling, and a REST API.

Live AI is powered by **Meta Muse Spark**, validated with `muse-spark-1.3`, for
structured fact extraction and draft assessments. Muse Spark also supports image
understanding; MendCue includes an optional appliance-label transcription path.
A separate, visibly labeled fixture mode runs without an API key. Photo
transcription requires live mode and an explicit image-billing gate; enabling photo
uploads alone does not enable AI image reading.
Manufacturer manuals are operator-imported and reviewed; the included example
playbooks do not establish model-specific coverage.

This release pins the tested model for reproducible results and spending estimates.
Newer Muse Spark versions can be adopted after checking structured outputs, image
behavior, and pricing and updating the model guard. Compatibility with untested
future versions is not implied. See [model versions and images](docs/deployment.md#model-versions-and-images).

## Prerequisites

| Task | Requirements |
| --- | --- |
| Local demo | Git, Node.js 20 or newer, npm; Linux, macOS, or Windows with WSL |
| HTTPS deployment | An always-on Linux server, Git, Docker Engine with Compose v2, a domain, DNS access, and available ports 80/443 |
| Live AI | A Meta Model API key with access to `muse-spark-1.3` and an intentional spending allowance |
| Browser checks | Chrome or Chromium; set `CHROME_BIN` if it is not discovered automatically |
| Importing manuals | Node/npm and Poppler's `pdftotext` on the operator workstation |

Check local tools with `node --version` and `npm --version`. For deployment, check
`docker --version` and `docker compose version`. Docker users do not need Node on
the server; the image includes it. OpenSSL is used to generate deployment secrets.

## Run a local demo

This is the quickest way to reproduce the application. No Docker, database, domain,
or Meta key is needed. Commands below use a Bash-compatible shell.

```bash
git clone https://github.com/ker2i/mendcue.git
cd mendcue
npm ci
npm run build
NODE_ENV=development DATABASE_URL= MODEL_PROVIDER=fixture SYNC_TURNS=1 \
  PORT=3000 APP_BASE_URL=http://localhost:3000 MEDIA_STORAGE_PATH=./data/media \
  node dist/server/index.js
```

Open:

- Customer intake: <http://localhost:3000/business/demo-phoenix-appliance>
- Technician workspace: <http://localhost:3000/staff/>
- Health: <http://localhost:3000/healthz>

Use these **synthetic local credentials** in the technician sign-in form:

| Field | Value |
| --- | --- |
| Business slug | `demo-phoenix-appliance` |
| Email | `tech@demo-phoenix.invalid` |
| Password | `demo-tech-1234` |

Try: “My LG washer stops with water inside and shows OE.” Answer the questions with
synthetic details, review the request, and submit. Sign into the technician workspace
to open the same request, review its brief, add a note, and create an internal
appointment. Fixture replies are deterministic; they do not demonstrate live AI or
photo recognition. Restarting this local mode resets cases and users; uploaded
files remain under ignored `data/` until removed.

Do not copy `.env.example` for this local mode. That template is for deployment.
The command above explicitly selects development, memory storage, and synchronous
processing even if deployment variables exist in your shell or `.env`.

## Deploy with HTTPS and PostgreSQL

Follow the [deployment guide](docs/deployment.md). It covers:

1. Domain/DNS and Docker prerequisites.
2. Private environment settings and generated secrets.
3. Building the image, applying migrations, and setting the runtime database password.
4. Provisioning your business and a private owner account.
5. Starting web, worker, and HTTPS services and checking the result.

On the server, clone the repository as above, then:

```bash
cp .env.example .env
chmod 600 .env
# Edit .env: set your HTTPS hostname and four different generated secrets.
# Use openssl rand -hex 32 for each password/secret. See the guide's settings table.
docker compose build
docker compose up -d --wait postgres
docker compose run --rm migrate
docker compose exec postgres psql -U intake -d intake -c '\password app_runtime'
```

At the password prompt, enter the exact `APP_RUNTIME_PASSWORD` saved in `.env`.
Next, [provision your business and owner](docs/deployment.md#4-provision-a-business-and-owner),
then start the application:

```bash
docker compose up -d web worker caddy
docker compose ps
```

Open `https://YOUR-HOST/business/YOUR-SLUG` and
`https://YOUR-HOST/staff/?business=YOUR-SLUG`. Start with fixture inference to check
the deployment, then enable live Meta with an explicit allowance. For a synthetic
judge deployment, the guide also explains how to seed the published demo accounts.

The guide covers Cloudflare Tunnel, backups, updates, notifications, and common
startup errors. Keep keys, customer data, completed tenant configuration, and
backups outside Git.

## Connect a website

After provisioning a business, add its website origin to the tenant's allowlist
and insert the widget script. See the [integration guide](docs/integration.md) for
hosted links, embedding, the included QuickFIX website connector, and API/webhook
integration. The [API specification](docs/openapi.yaml) describes the endpoints.

Additional operator guides:

- [Technician app, scheduling, and notifications](docs/technician-app.md)
- [Reviewed document import](docs/knowledge-import.md)

`demo-site/` is a separate static, scripted product walkthrough; it makes no model
calls and submits no requests. `quickfix-site/` contains the public business website
integration. Neither static site can host the Express backend.

## Verify the application

```bash
npm run typecheck
npm test
npm run build
node scripts/browser-acceptance.mjs
node scripts/technician-browser-acceptance.mjs
npm run quickfix:test
```

The first three commands need no browser or Meta key. Browser checks use synthetic
fixtures and an isolated local application. The optional actual-PostgreSQL tests
require `TEST_POSTGRES_URL` pointing to a dedicated local database whose name starts
with `mendcue_test`; never point test commands at a customer database.

## Project layout

- `src/` — application, Meta adapter, operator tools, and worker
- `migrations/` — PostgreSQL schema and tenant isolation
- `tests/` — automated checks
- `scripts/` — build verification, document import, diagnostics, and backup tools
- `docs/` — deployment and integration/operator guides, configuration template, API spec
- `examples/integration/` — widget and webhook examples
- `demo-site/`, `quickfix-site/` — static website code and bundled font licenses

Appointments are internal records; they do not send customer confirmations or create
external calendar events. Email and push require separate configuration. Live
inference, fixture checks, and real technician outcomes are distinct evidence;
no accuracy or time-savings result is implied by the included examples.
