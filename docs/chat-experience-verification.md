# Customer chat verification — November 1, 2026

Rebuilt the customer iframe around a persistent conversation and composer. The
assistant introduces itself as AI, explains that it gathers repair details for the
technician, and opens with one clear question. Optional controls and privacy text
sit in a More menu. Consent remains an explicit customer choice. Identity forms
stay folded until needed; review and submission retain the existing server workflow.

Messages reconcile with the authoritative transcript without rebuilding the thread.
Retries reuse the same idempotency key after a lost response, pending work continues
past the previous polling limit, and drafts and pending turns survive iframe reloads.
The composer supports Enter to send and Shift+Enter for a new line. Submitted cases
offer a new-request action. Greeting-only and appliance-only messages no longer
become misleading symptom facts.

## Executed checks

- Build, typecheck, JavaScript syntax and diff whitespace checks passed.
- Unit/integration suite: 104 passed, one container-only test skipped.
- Existing browser suite: 41/41 passed. Updated its keyboard check to enter a draft
  before tabbing to Send, which now correctly stays disabled for an empty message.
- QuickFIX browser suite: 22/22 passed using synthetic fixtures, including a lost
  response after server commit, idempotent retry, reload while queued, a reply after
  more than 24 polls, draft preservation, submission into the technician inbox,
  a fresh request after submission, and a 320px viewport.
- Deployed changed backend sources and rebuilt web/worker containers on the existing
  VPS. Updated the QuickFIX tenant greeting without changing credentials or records.
- Live browser check on quickfixphx.com passed the welcome, a polite greeting-only
  response, one synthetic queued repair turn through live Meta, preserved next draft,
  phone layout, and absence of browser JavaScript errors.
- Screenshots: `screenshots/quickfix-chat-desktop.png` and
  `screenshots/quickfix-chat-phone.png` show the live customer experience.

## Asset cache and website upload

Cloudflare served previously cached unversioned JavaScript and CSS with the new
HTML. Page shells now use a content hash in asset URLs, preventing that mismatch
on subsequent deployments. This fix was deployed and verified live.

The website's loader URL also now has a version. The current Pages deployment can
still use its cached older popup wrapper until refreshed or cache expiry. The
updated static ZIP contains the versioned loader URL and was copied and checksum
verified at `C:\Users\Yunus\Downloads\quickfix-website-upload.zip`. Upload that ZIP to
the existing Pages project to activate the larger popup, compact close button,
hidden launcher while open, and visual-viewport mobile sizing immediately. Pages
account credentials are unavailable here; this static upload remains a user step.

Browser checks are functional evidence, not a measurement of diagnostic accuracy,
customer satisfaction, or technician time saved. No real customer details were used.

## Follow-up: missing chat launcher

A fresh browser reproduced a blocked cross-origin `/widget/v1.js` request with
`net::ERR_BLOCKED_BY_ORB`; the website left its request button hidden because it
only revealed it after the script loaded. Subsequent direct retrieval returned
JavaScript with HTTP 200, and another fresh public-site browser check successfully
opened the iframe and enabled the composer. The backend containers were healthy.
The exact cause of the intermittent edge response was not established.

The replacement website ZIP now serves a copy of the widget loader from the same
website origin. Its explicit `data-platform` attribute keeps API and iframe traffic
on the correct backend. The HTML repair action is now an ordinary visible link to
the hosted intake; successful popup loading enhances that link. Loader or public
configuration network failures leave the link usable. Explicitly disabled public
configuration still hides the integration. Public connection generation retains the
tenant slug so fallback links target the correct hosted tenant.

Executed: build, JavaScript syntax, exact equality of packaged/source widget,
whitespace checks, and 25/25 fixture browser checks including blocked loader and
failed configuration. The ZIP in Windows Downloads was replaced and checksum
verified. These static improvements require uploading the replacement ZIP to Pages;
they have not been published through a Pages account here.

## Returning customers: new request action

Added a visible “New request” action to the chat toolbar, available for restored,
unfinished and submitted conversations when no message/upload/submit is in flight.
It creates a fresh case and clears the current transcript, draft, consent, details
and review UI; the previous request remains saved on the server. The composer is
focused when the new session is ready. An older review response cannot replace the
new request's review UI. Existing automatic history restoration remains available
until the customer chooses to start fresh.

Build, typecheck, JavaScript syntax and diff checks passed. The 28/28 fixture browser
checks include restoring a previous conversation, starting fresh from the toolbar,
resetting customer state, and verifying the old server messages remain saved.
Deployed the page shell, customer script and styles to the VPS web service. This
change is delivered by the backend and does not require another website ZIP upload.
