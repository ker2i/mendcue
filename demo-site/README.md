# MendCue public demo

A static product presentation and interactive, synthetic intake walkthrough.
No server, build step, API key, model inference, analytics, cookies or browser
storage is required. Inputs and photo previews stay in the current tab; JSON
exports are explicitly downloaded by the visitor. Refresh resets the demo.

For live MendCue customer intake, visit **[QuickFix Appliance Repair](https://quickfixphx.com/)**
and choose **Start a repair request**. This directory is the separate scripted
walkthrough; its replies and technician actions do not call the live backend.

## Preview and verification

From the repository root:

```sh
npm run demo:preview
# http://127.0.0.1:4321
npm run demo:test
```

Browser verification requires the existing `puppeteer-core` dev dependency and
Chrome. Set `CHROME_BIN` if needed. It serves the site under `/mendcue/` to check
GitHub project-path compatibility, exercises real interactions, and saves rendered
screenshots in `docs/screenshots/demo-*.png`.

## Free GitHub Pages hosting

GitHub Pages supports this static HTML/CSS/JS site. Public repositories are
supported on GitHub Free, including organizations. See
[GitHub’s hosting documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).
The application’s Express backend and live Meta requests require separate hosting;
this public demo intentionally runs without either.

1. Commit and push the demo files and `.github/workflows/demo-pages.yml` to `main`.
2. In the GitHub repository, open **Settings → Pages → Build and deployment**.
   Select **GitHub Actions** as the source.
3. Run **Deploy MendCue demo to GitHub Pages** from the Actions tab, or push a demo
   change after enabling Pages. The workflow publishes only `demo-site/`.
4. For `ker2i/mendcue`, the expected project address is
   `https://ker2i.github.io/mendcue/`. The workflow’s deployment result is the
   authoritative live URL. No custom domain is required.

The workflow uses the official configure/upload/deploy Pages actions and scoped
`pages: write` / `id-token: write` permissions. See
[GitHub’s workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
The workflow deployment result supplies the published URL.

## Demo boundaries

- Washer, refrigerator, and gas-smell scenarios are synthetic and scripted.
- Edited label fields are manual input; photographs are local previews, not OCR.
- Generic guidance is example content, not reviewed manufacturer documentation.
- “Create demo brief” creates browser state; it sends no real service request.
- Approval is a simulated staff action, not a technician grade or repair outcome.
- No fabricated customer logos, testimonials, business results or live AI metrics.

## Assets

The visual composition and appliance icons use HTML/CSS/SVG. DM Sans and Manrope
Latin variable fonts are bundled locally from Google Fonts; their SIL Open Font
Licenses are retained beside the `.woff2` files. No third-party font request is
needed to use the page.
