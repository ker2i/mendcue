# MendCue — implementation review and redesign brief

Reviewed October 29, 2026, against commit `63ecfc4`.

This is a review of the local implementation, with design recommendations and targeted functional checks. It is not a complete security audit or a claim of production readiness. Application source was not changed during this review.

## Overall assessment

The implementation provides a useful application scaffold, but several core workflows are incomplete or fail outside the narrow fixture tests. It needs functional repairs before a supervised customer pilot. The design needs clearer hierarchy, structured case information, tenant branding, and a customer journey with visible progress and a real review step.

Existing verification passed:

- `npm test`: 23 tests across six files.
- `npm run typecheck`.
- `npm run build`.

Those tests use a seeded in-memory store and deterministic fixture model. They do not exercise a real browser, PostgreSQL deployment, real image recognition, or the live Meta API.

Additional API and engine probes reproduced failures listed below. All test customers, credentials, and cases were synthetic and used isolated local or in-process instances. No live model calls or paid services were used.

Browser tooling and PostgreSQL image downloads timed out. Consequently, browser rendering, browser execution of the HTML injection, and a full PostgreSQL deployment were not executed. Source-inspection findings are identified separately from reproduced behavior.

## Fix order

1. Move safety screening ahead of every message shortcut.
2. Repair hosted-site session creation and genuine cross-origin embedding.
3. Eliminate unsafe HTML rendering and enforce authorization permissions.
4. Repair submission, correction, refresh, and queued-message behavior.
5. Verify PostgreSQL migrations, seeding, RLS, and Compose networking.
6. Implement the customer and technician layouts described later in this document.
7. Exercise live Meta requests with a small, explicitly budgeted scenario set.

Do not count a passing fixture test suite as evidence that the above behaviors work.

## Findings that block a pilot

### R01 — Hazard reports bypass safety during model confirmation

**Priority:** P0. **Evidence:** reproduced through the HTTP API.

**Locations:** `src/server/app.ts:193`, `src/domain/intake.ts:435`.

The message route runs the model-confirmation shortcut before `processTurn`, which contains hazard screening. The confirmation function accepts almost any response of three or more characters as a corrected model number.

Reproduction:

1. Start an intake and upload a label whose extracted text is `MODEL ABC234`.
2. The assistant asks whether the model is correct.
3. Reply `I smell gas`.

Observed response:

```text
Thanks — model recorded as I smell gas.
```

The response has `confirmed: true`. The case safety status remains `unchecked`; no emergency response is produced. This route bypass is independent of whether the normal provider is fixture or live.

**Required change:** screen every customer message before model confirmation, job queuing, and other shortcuts. Store an explicit pending-confirmation state. Only accept affirmative confirmation or a validated model correction; treat other replies as normal conversation. Keep unresolved hazard state active until an appropriate explicit transition.

**Acceptance:** a hazard report must interrupt both normal intake and label confirmation; it must never become an appliance identifier.

### R02 — Hosted intake and cross-origin embedding fail

**Priority:** P1. **Evidence:** HTTP requests reproduced both failure conditions; browser preflight behavior identified from the response.

**Locations:** `src/server/app.ts:61`, `src/content/seed.ts:21`, `src/server/pages.ts:34`.

The Phoenix tenant allows origins on port 3100 and the second tenant allows port 3101. The documented hosted application runs on port 3000. The local review instance on port 4317 was likewise rejected when sending its own origin.

Observed same-origin session response:

```text
403 ORIGIN_NOT_ALLOWED
This website is not enabled for intake.
```

For an allowed external origin, the `OPTIONS` response has no `Access-Control-Allow-Origin` header. The widget sends JSON cross-origin, which requires a successful browser preflight. Allowing an origin inside the POST handler does not supply the missing CORS response.

**Required change:** explicitly support the platform's hosted origin and configure tenant-aware preflight/response headers for external embedding. Preserve restrictions on which organizations can be embedded by which origins. Do not use an unrestricted CORS policy for protected staff or integration APIs.

**Acceptance:** complete intake on the documented hosted URL and a genuinely separate host origin in a browser. A page labeled “second origin” on the same server is not sufficient evidence.

### R03 — Customer content reaches an unsafe staff HTML sink

**Priority:** P1. **Evidence:** source-to-sink data path reproduced; browser execution was not run.

**Location:** `src/server/pages.ts:211`.

The staff inbox concatenates customer-controlled complaint text and other values into `innerHTML` without escaping. A newly created case containing this harmless diagnostic marker reached the staff cases response unchanged:

```html
<img src=x onerror="window.__mendcueReviewMarker=1">
```

That value is inserted into the staff page as markup when the inbox is loaded. The payload fits within the 80-character complaint truncation. Cases do not need to be submitted to appear in this inbox.

**Impact:** the implementation has a stored HTML/script injection path into an authenticated staff interface. An injected script could make same-origin requests with the staff user's browser privileges. HTTP-only session cookies alone do not prevent those requests.

**Required change:** construct rows with DOM elements and `textContent`, or use a templating/component system that escapes untrusted strings by default. Review hosted-page interpolation of configurable tenant text too. Add a restrictive content security policy after removing inline script dependencies where practical.

**Acceptance:** the marker appears literally as text and cannot create an image element or set a browser property. Add a real browser regression check.

### R04 — Staff roles and service-key scopes are not enforced

**Priority:** P1. **Evidence:** reproduced with synthetic credentials in an isolated in-process application.

**Locations:** `src/server/staff.ts:36`, `src/server/staff.ts:98`, `src/server/integration.ts:12`.

Observed results:

| Credential | Operation | Result |
|---|---|---|
| Staff user with `readonly` role | Close a case | HTTP 200 |
| Staff user with `readonly` role | Write a repair outcome | HTTP 200 |
| Service key with an empty scopes array | Create an integration session | HTTP 201 |
| Service key with an empty scopes array | Read a submitted handoff | HTTP 200 |

The staff middleware checks the session and CSRF but never authorizes the stored staff role. Integration middleware stores scopes on the request but endpoints do not check them.

**Required change:** implement a server-enforced permission matrix. Read-only staff must not mutate cases or outcomes. Require `sessions:write` and `handoff:read` on their respective integration endpoints. Revalidate user membership and access when processing requests.

**Acceptance:** each unauthorized operation returns 403 and makes no state change. Include positive and negative tests for each role/scope combination.

### R05 — Submission behavior does not match the customer interface

**Priority:** P1. **Evidence:** reproduced through the HTTP API and verified in the client handler.

**Locations:** `src/domain/intake.ts:235`, `src/server/pages.ts:133`, `src/domain/intake.ts:464`.

There are two inconsistent behaviors:

- The assistant says to reply “submit,” but that message only generates another review summary. The case remains in `review`.
- The “Review & submit” button immediately calls the final submission endpoint. There is no review screen. A brand-new empty case can be submitted and returns `assessmentStatus: "ok"`.

**Required change:** provide a real review state with editable appliance, symptoms, contact, location, and preferences. Use a distinct final “Send request” action. Text confirmation should follow the same reviewed transition. Define minimum requirements for an ordinary callback/service request and an explicit incomplete/emergency route; do not force all cases through the same completeness policy.

**Acceptance:** ordinary cases cannot accidentally submit an empty request; missing information is visible; final confirmation creates exactly one handoff. A textual confirmation works as described.

### R06 — Queued mode can acknowledge two messages and process neither

**Priority:** P1. **Evidence:** reproduced through the queue/worker engine.

**Locations:** `src/server/app.ts:214`, `src/worker/worker.ts:36`.

When the first turn job is pending, a second customer message is stored but does not get its own job. The worker then discards the first job because it finds a newer customer message. No job remains for the second message.

Observed after one worker pass:

```text
Customer messages stored: 2
Assistant messages produced: 0
Pending turn job: false
```

Additionally, the browser prints `(processing…)` for an asynchronous response and never subscribes to events or polls for the eventual reply. Label uploads in asynchronous mode are stored but no label job is enqueued.

**Required change:** establish one consistent queue protocol. Either enqueue each message and serialize processing per case, or intentionally coalesce messages with a durable pointer to all unprocessed input. Implement client event/poll recovery and enqueue label work. Recheck version and safety after generation before committing output.

**Acceptance:** send two quick messages while processing is delayed. Both must affect the eventual case, with no lost processing or duplicate facts. Queued replies and label results must become visible without manual refresh.

### R07 — Refresh loses access to the ongoing intake

**Priority:** P1. **Evidence:** source inspection; single-use bootstrap behavior exercised through the API.

**Locations:** `src/server/pages.ts:18`, `src/server/pages.ts:99`, `src/server/app.ts:95`.

The case token is held only in a JavaScript variable. Reloading the iframe reuses a bootstrap code that has already been consumed. The suggested recovery instruction asks the customer to reload, which repeats the same failure.

The bootstrap code is also placed in the iframe query string rather than transferred through a checked message handshake. Exchange does not check the bootstrap session expiry before minting a fresh session, and read/mark consumption is not atomic.

**Required change:** implement the specified bootstrap handshake and case-scoped session resumption, with a bounded lifetime, atomic code consumption, and no credentials in URLs. Store a resumable capability appropriately within the iframe's session context. On failure, offer a real restart or recovery action.

**Acceptance:** a reload restores the same conversation and case. Expired or previously used bootstrap codes cannot mint a new capability. Concurrent exchange must succeed only once.

### R08 — Label identification can select a serial number as the model

**Priority:** P1. **Evidence:** reproduced through the HTTP API using the deterministic OCR-text hook; applies to the shared downstream parser.

**Location:** `src/domain/intake.ts:390`.

The parser selects the longest alphanumeric token containing a digit from the entire OCR transcription. It ignores the model field returned by the vision provider.

Input:

```text
LG MODEL WM3900HBA SERIAL 404KWXYZ12345
```

Observed model candidate:

```text
404KWXYZ12345
```

**Required change:** use the structured model field and label-aware extraction, preserve serial separately, and ask for confirmation. A model should become confirmed only through the explicit confirmation flow. Remove or test-gate the public `labelText` override before a live pilot.

**Acceptance:** a longer serial number does not replace the model; uncertainty and corrections preserve provenance.

## Additional functional and infrastructure issues

### R09 — Customer correction and out-of-area flows loop

**Priority:** P1. **Evidence:** reproduced through the HTTP API.

**Locations:** `src/domain/intake.ts:187`, `src/domain/intake.ts:220`.

After reporting LG, correcting to Samsung, and answering “Samsung” to the clarification, the assistant repeats the same conflict. No pending conflict-resolution state is recorded and applied.

An out-of-area ZIP returns the same “Would you like me to continue?” message after both “Yes, please continue” and “submit.” The service-area branch runs before the handoff branch on every turn.

**Required change:** model these as explicit decisions with stored resolution. Preserve superseded facts. Allow the promised out-of-area summary/human route after an affirmative answer.

### R10 — PostgreSQL seeding and RLS setup need real integration verification

**Priority:** P1. **Evidence:** parameter-binding defect reproduced; remaining observations are from source inspection. A real database run was not completed.

**Locations:** `src/db/pg.ts:222`, `migrations/002_rls.sql:9`, `compose.yaml:48`, `src/db/pg.ts:157`.

Verified defect: `PgStore.saveChunk` binds `c.tenantId` as `document_id` instead of `c.documentId`. A shared chunk therefore binds `null` for its document ID. This violates the schema's required document relationship and prevents correct seeding/retrieval.

Other database concerns requiring an integration run:

- Migration 002 uses `GRANT CONNECT ON DATABASE CURRENT_CATALOG`; this is not a dynamic substitution of the current database name. Verify/fix the statement against the target PostgreSQL server.
- Compose uses the bootstrap database owner for web and worker. That role bypasses row-level security.
- Simply switching to `app_runtime`, as the deployment guide suggests, is insufficient: customer/staff session lookup, service-key lookup, and worker leasing include queries outside tenant-scoped transactions. Their RLS policies require tenant context. Design narrow authentication/bootstrap and worker-lease paths that can operate before tenant context is established.
- Foreign keys for child case records do not consistently enforce the tenant/case pair as a composite relationship.

**Required change:** test migration, seeding, restart, authentication, knowledge retrieval, and jobs with the intended restricted runtime role. Include real PostgreSQL cross-tenant tests.

### R11 — Compose networking and custom-domain setup are incomplete

**Priority:** P1 before VPS deployment. **Evidence:** source inspection; deployment not run.

**Locations:** `compose.yaml:55`, `compose.yaml:72`, `compose.yaml:74`, `Caddyfile:2`.

- The worker connects only to a Docker network declared `internal: true`. External Meta calls and webhook delivery require egress.
- Caddy reads `DOMAIN` from its container environment, but Compose does not pass that variable into the Caddy service. Adding it only to the host `.env` file does not automatically set it inside Caddy.
- The environment template sets synchronous turns for web, while the operating guide describes queued web behavior. Align the actual deployment and client support.

**Acceptance:** verify public HTTPS on the configured domain, database readiness, worker health, outbound Meta connectivity, and delivery to a real controlled webhook receiver.

### R12 — Live model output is not independently schema-validated

**Priority:** P1. **Evidence:** reproduced with a stubbed HTTP response; no live model call.

**Locations:** `src/integrations/meta/meta.ts:171`, `src/domain/intake.ts:157`, `src/server/index.ts:51`.

A valid JSON response containing only `{"proposedFacts":[]}` reaches the engine and throws:

```text
TypeError: result.hazardSignals is not iterable
```

The engine catches `ModelFailure`, so this error bypasses the intended fallback. TypeScript casts do not perform runtime validation. Also review async error propagation: the project uses Express 4 with bare async route handlers, so thrown/rejected errors need explicit forwarding or a consistent async wrapper.

**Required change:** validate provider results with runtime schemas and convert invalid provider output to a typed model failure. Supply the active question ID/text and relevant conversation context to extraction; currently the live adapter sends the new message, known facts, and allowed ID lists without the question the customer is answering.

**Acceptance:** malformed JSON, valid-but-wrong-shape JSON, refusal, timeout, and HTTP failure all reach a usable fallback without an unhandled rejection. Short contextual answers such as “three years” and “both” are interpreted in relation to the actual question.

### R13 — Webhook retries change event identity and ignore retry timing

**Priority:** P2. **Evidence:** reproduced with a controlled stub receiver.

**Locations:** `src/worker/worker.ts:86`, `src/db/pg.ts:259`, `src/db/memory.ts`.

The worker builds a new event ID on each delivery attempt. Two attempts for the same logical submission produced different IDs, preventing receiver deduplication by the documented event ID. Failed jobs can also be immediately leased again; the calculated retry timestamp is not used to make them unavailable until the backoff expires.

Submission updates, handoff creation, and outbox enqueue are separate store transactions despite the “transactional outbox” comment. A partial failure can commit a submission without its outbound event.

**Required change:** create the logical event once, persist it transactionally with the state transition, reuse its ID/body across attempts, store an actual `available_at` timestamp, and make delivery history and sequencing stable. Skip already-successful endpoint deliveries during retry fan-out. Revalidate webhook destinations and redirect/DNS behavior when sending.

### R14 — Declared controls and product features exceed implementation

**Priority:** P1/P2 depending on feature. **Evidence:** source inspection and existing test behavior.

- `GLOBAL_AI_SPEND_LIMIT` is documented but is not enforced in application source. Token usage from provider responses is not recorded. Add spend/turn limits before enabling unrestricted public live-model traffic.
- Consent is automatically recorded as explicit consent on the first customer message; there is no corresponding explicit control.
- Image handling checks a short magic-byte prefix but does not decode/re-encode images or strip metadata. Existing tests intentionally use a header plus filler, not a real decodable image.
- Staff passwords are hashed with a single unsalted SHA-256 operation. Replace with an appropriate password hashing function or established authentication component, and add login rate limiting.
- Seeded demo credentials and a service key are known from source. Do not expose those demo tenants with real customer data.
- Retention configuration has no cleanup implementation. Do not present retention periods as enforced until jobs exist and are verified.
- There are five generic seeded playbook chunks and no exact-model manuals. The seed's `demo-reviewer` string does not establish actual technician approval. Use clearly labeled example content until a real reviewer approves it.
- The claimed knowledge ingestion flow has no working upload/review/publish interface. The staff API only reads knowledge.
- Routing and branding settings exist in data, but substantial UI and routing behavior are still missing.
- Suggested question/action validation does not consistently enforce category, exclusions, active hazards, and playbook version. The action path checks preconditions but omits `hazardExclusions`.
- Health reporting returns success without checking the database or worker. Its success does not prove readiness.
- The documented local `npm run dev` script references `ts-node`, which is absent from the declared dependencies. The README also copies a PostgreSQL URL into `.env` before the no-database quick start; document distinct working local modes.

## Design diagnosis

The current templates are concentrated in `src/server/pages.ts`:

- The hosted page reads like setup documentation: one heading and several explanatory paragraphs.
- The customer interface exposes a text field and several competing file/human/submission buttons in a single row.
- There is no visible journey, structured review, or useful summary of collected details.
- Widget launcher dimensions are fixed at 380 × 600, and the actions are not designed to wrap for narrow screens. Verify actual viewport behavior in a browser.
- The tenant widget configuration is fetched but its name, branding, opening message, and privacy text are not populated into the intended UI elements.
- The staff inbox is an unstructured run of text and buttons.
- The main handoff is a JSON dump truncated at 4,000 characters. Important later fields can disappear from the display even though the API returned them.
- There are no usable photo previews, source viewers, or staff photo-access flow in the case UI.
- Outcome saving shows “Outcome saved” without checking whether the request succeeded.

These problems affect comprehension and task completion, not just visual polish.

## Proposed visual direction

Aim for a calm, capable service product: clear typography, restrained color, large readable controls, and strong status hierarchy.

Suggested starting tokens:

```css
:root {
  --canvas: #f6f7f5;
  --surface: #ffffff;
  --ink: #152a2d;
  --muted: #5b696a;
  --border: #dce3df;
  --primary: #0f766e;
  --danger: #b42318;
  --radius-card: 16px;
  --radius-control: 10px;
}
```

Use a consistent spacing scale based on 4/8-pixel increments. Start with 16-pixel customer body text, clearly differentiated headings, and comfortable touch targets. Validate contrast, keyboard navigation, focus treatment, zoom, and narrow-screen behavior rather than assuming the token choices guarantee accessibility.

Use actual tenant branding for embedded and hosted business surfaces. MendCue can appear as a restrained platform attribution. A separate MendCue marketing page can explain the product to prospective repair firms and insurers.

Extract shared styles, rendering components/templates, and client behavior from the giant HTML strings. A complete backend rewrite is unnecessary to implement these layouts.

## Screen 1 — hosted repair-business website

The Phoenix pilot needs a small business site with a clear service-request action.

Recommended content order:

1. Tenant logo/name and real contact alternative.
2. Short headline: “Tell us what's wrong. We'll help prepare your repair.”
3. One paragraph explaining that the service team reviews the request.
4. Primary “Start a service request” button.
5. Appliance categories and actual service area.
6. A short three-step process: describe, provide details, team follows up.
7. Contact/privacy information.

Preserve conspicuous demonstration labeling until the real business details are supplied. Avoid invented reviews, certifications, savings statistics, or appointment availability.

## Screen 2 — customer intake

Build a conversational flow with structured controls where they make answering easier.

Header:

- Tenant name/logo.
- “Appliance service request.”
- A compact progress indicator: Appliance → Problem → Details → Review.
- Close/minimize and human-contact options.

Conversation:

- A brief opening message and explicit processing disclosure.
- Appliance choices presented as buttons/cards.
- Quick replies for questions with a small answer set.
- One question per turn with “Not sure” and “Skip” when allowed.
- An accessible photograph upload control with preview and upload/processing state.
- A dedicated label confirmation card with editable model and serial fields.

Collected information:

- Desktop: a quiet summary panel beside the conversation.
- Mobile: a collapsible “Details collected” section.
- Show unknown values honestly and let customers edit them.

Composer:

- Large text field or textarea, one primary send button, and a secondary attachment action.
- Disable duplicate submission while a turn is pending, while preserving input and allowing emergency/human actions.
- Show recovery controls on network failure instead of clearing the only copy of a message.
- Keep the latest response visible and support scrolling within the conversation.

On phones, use a viewport-fitting full-height sheet. Provide a working close/back action and a full-page fallback. Avoid a fixed-width floating panel that can extend beyond the screen.

## Screen 3 — review and confirmation

The review screen should look like a short service request, not another chat paragraph.

Sections:

- Appliance and identification confidence.
- Reported issue and timeline.
- Observations/checks already performed.
- Location and contact.
- Preferred callback/visit window.
- Missing or uncertain information.

Each section gets an Edit action. Keep the final button explicit: “Send request to [business].” Explain that the service team will confirm scheduling.

After successful submission show a confirmation card with the reference, the actual next step configured by the tenant, and a contact alternative. Do not promise an unconfigured response time.

## Screen 4 — technician and dispatcher workspace

Desktop layout:

- Navigation with organization identity.
- Small counters derived from real data: New, Needs review, Human requested.
- Search/filterable inbox with appliance, issue, ZIP, safety, age, and workflow status.
- Case detail panel or dedicated case route.

On phones, convert inbox rows into compact tappable cards. Keep the most important actions reachable without horizontal scrolling.

Case detail must lead with a readable brief:

1. Appliance, brand/model, and whether identification is confirmed.
2. Customer's reported complaint.
3. Safety and urgency flags.
4. Contact and service area.
5. Key observations and checks already attempted.
6. Preliminary issue areas with supporting/contradicting evidence.
7. Missing information and recommended next follow-up.
8. Photos and cited sources.

Provide expandable Transcript and Audit history sections. Use explicit labels such as Reported by customer, Extracted from photo, AI hypothesis, and Technician confirmed.

Add copy/print/export actions, assignment controls, notes, and a clear outcome form. Ensure API support and permissions for staff to view private photographs; the existing customer bearer-only attachment route is insufficient for the staff UI.

Keep full JSON export available as a secondary integration tool. Render all relevant handoff fields without arbitrary truncation.

## Screen 5 — tenant settings and integrations

The shared platform needs a small working settings interface, or a clearly documented operator-managed configuration workflow for the pilot.

Prioritize:

- Business identity and branding preview.
- Service area and supported appliances.
- Required intake fields.
- Destination queue and notification behavior.
- Website origins and copyable embed snippet.
- Scoped service credentials.
- Webhook setup and delivery history.
- Knowledge approval state and coverage.

Insurer-specific external references should be supplied by an authorized backend. Keep coverage decisions out of the assistant's customer conversation unless a real authorized business integration provides the outcome.

## Acceptance run after fixes

Use a real browser and a real PostgreSQL instance for this run.

1. Complete hosted-site intake from its normal URL.
2. Complete an intake embedded on a genuinely separate origin.
3. Repeat at phone and desktop sizes with keyboard-only navigation.
4. Refresh during a conversation and recover the same case.
5. Correct brand/model and resolve an out-of-area decision.
6. Report a hazard during a model-confirmation prompt.
7. Send rapid consecutive messages in queued mode.
8. Upload a real label photograph with a longer serial than model number.
9. Review/edit details and submit once; verify the handoff appears for staff.
10. Read the complete handoff, photos, and citations as staff.
11. Verify read-only roles, scoped keys, and cross-tenant denial on the real database.
12. Retry an outbound webhook with a stable event ID and actual backoff.
13. Restart web/worker and confirm persisted state.
14. Run a small live Meta scenario set and record measured latency/cost and failure behavior.

## Prompt for Muse

> Read REVIEW.md and DESIGN.md. Fix R01–R12 in dependency order, using the reproduced cases as regression scenarios. Preserve the shared tenant-aware architecture and verify the flows on a real browser and PostgreSQL database. Enforce roles and scopes, correct model confirmation and safety ordering, and implement real session recovery, review/submission, and queued client updates.
>
> Then implement the customer and technician screens described in the design brief. Apply tenant branding, structured summaries, editable review, readable handoff sections, photos, sources, responsive controls, and honest pending/error states. Extract UI code into maintainable shared components/templates and client modules.
>
> Treat R13 and R14 as explicit remaining work. Remove inaccurate operating claims while capabilities are incomplete. Keep demo content visibly labeled; do not imply live Meta, real technician approval, comprehensive manuals, or successful insurer integrations without evidence.
>
> Report what was fixed, which browser/database/live-model checks actually ran, and what remains. Do not substitute fixture assertions for end-to-end verification.
