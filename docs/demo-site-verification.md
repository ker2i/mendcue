# Public demo site verification — October 29, 2026

The new `demo-site/` is a standalone static MendCue presentation and interactive
walkthrough. It does not replace the Express product or claim to be a deployed
live AI service. All case scenarios are synthetic; answers are scripted.

Implemented: responsive landing page, three scenario selectors, contextual scripted
questions, visitor notes, editable identity, manual transcription confirmation,
local label-photo preview, explicit brief creation, technician view and simulated
approval/urgent review, evidence modal, JSON download, reset, keyboard tabs, FAQ,
reduced-motion styles, and a GitHub Pages workflow publishing only `demo-site/`.
No third-party runtime dependencies or requests; fonts and licenses are bundled.

Executed in real Chrome via `npm run demo:test`: **22/22 checks passed**.
The test serves under `/mendcue/`, exercises the complete washer and refrigerator
flows plus gas-smell escalation, verifies model suffix/serial separation, inert
visitor markup, photo preview and JSON export, tab keyboard navigation, source
limitations, identity correction, reset, 390px/320px reflow, reduced motion, and
absence of third-party/model requests and page/asset errors.

Also passed: application `npm run typecheck`, `npm run build`, JS syntax checks,
workflow YAML parse with artifact-directory assertion, and `git diff --check`.
No backend application code or database schema was changed for this site.

Rendered screenshots from the browser run:

- [Desktop hero](screenshots/demo-hero.png)
- [Desktop full page](screenshots/demo-desktop.png)
- [Phone full page](screenshots/demo-phone.png)
- [Phone interactive section](screenshots/demo-phone-interaction.png)

Local preview: `npm run demo:preview` → `http://127.0.0.1:4321`.
Hosting steps: [demo README](../demo-site/README.md).
The Pages workflow has not been pushed or executed, and Pages settings have not
been changed. No hosted URL is claimed as live. GitHub’s free-tier eligibility
and official Actions workflow were checked against the sources linked in the README.

Remaining external verification: the first actual GitHub Actions/Pages deployment.
Live Meta behavior, technician pilot evidence, and reviewed manufacturer documents
are separate product work; this static walkthrough does not establish those results.
