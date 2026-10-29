// Page shells. All styling and behavior live in /static/* (external files)
// so pages can be served under a restrictive Content Security Policy.
// Server-side tenant text is HTML-escaped; clients use textContent only.
import express from "express";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppDeps } from "./app.js";

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), "ui");
const APP_CSS = readFileSync(join(UI_DIR, "app.css"), "utf8");
const WIDGET_JS = readFileSync(join(UI_DIR, "widget.js"), "utf8");
const INTAKE_JS = readFileSync(join(UI_DIR, "intake.js"), "utf8");
const STAFF_JS = readFileSync(join(UI_DIR, "staff.js"), "utf8");
const HOSTED_JS = readFileSync(join(UI_DIR, "hosted.js"), "utf8");

export const PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; " +
  "img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; " +
  "base-uri 'self'; form-action 'self'";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shell(opts: { title: string; css?: boolean; js?: string; body: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(opts.title)}</title>
${opts.css === false ? "" : '<link rel="stylesheet" href="/static/app.css">'}</head>
<body>${opts.body}
${opts.js ? `<script src="${opts.js}" defer></script>` : ""}
</body></html>`;
}

const EMBED_BODY = `
<div class="sheet">
  <div class="demo-banner" id="demoBanner"></div>
  <header class="sheet-header">
    <div class="biz" id="biz">Service intake</div>
    <div class="steps" id="steps" aria-label="Progress"></div>
  </header>
  <div class="muted pad-x small" id="privacy"></div>
  <div class="pad-x warnline" id="fixture"></div>
  <details class="collected" id="detailsBox">
    <summary>Details collected</summary>
    <div id="detailsBody"></div>
  </details>
  <div id="cardBox"></div>
  <main class="log" id="log" aria-live="polite"></main>
  <div class="quick pad-x" id="quickBox"></div>
  <div id="reviewBox" class="hidden pad-x"><h2>Review your request</h2><div id="reviewBody"></div></div>
  <div class="statusbar" id="status" role="status"></div>
  <div class="consent">
    <label style="font-weight:400"><input type="checkbox" id="consentBox"> I understand this intake collects my appliance details for the service team.</label>
    <span id="consentNote" class="muted"></span>
  </div>
  <div id="photoPreview" class="pad-x"></div>
  <div class="composer">
    <input type="text" id="in" placeholder="Type your message…" autocomplete="off" aria-label="Message">
    <button id="send" class="btn btn-primary" type="button">Send</button>
  </div>
  <div class="composer flush">
    <input type="file" id="photo" accept="image/jpeg,image/png,image/webp" aria-label="Label photo">
    <button id="uploadBtn" class="btn" type="button">Upload label photo</button>
    <button id="humanBtn" class="btn" type="button">Talk to a person</button>
    <button id="reviewBtn" class="btn" type="button">Review</button>
  </div>
</div>`;

function staffBody(): string {
  return `
<div class="page">
  <h1>Staff workspace</h1>
  <div id="login" class="card">
    <h2>Login</h2>
    <label for="slug">Tenant</label>
    <input type="text" id="slug" placeholder="e.g. demo-phoenix-appliance" autocomplete="off">
    <label for="email">Email</label>
    <input type="text" id="email" placeholder="email" autocomplete="username">
    <label for="pw">Password</label>
    <input type="password" id="pw" placeholder="password" autocomplete="current-password">
    <p><button id="go" class="btn btn-primary" type="button">Log in</button></p>
  </div>
  <div id="app" class="card hidden">
    <div><span id="who" class="muted"></span></div>
    <p>
      <button id="tabInbox" class="btn" type="button">Inbox</button>
      <button id="tabSettings" class="btn" type="button">Settings</button>
      <button id="refresh" class="btn" type="button">Refresh</button>
    </p>
    <div id="inboxPane">
      <div class="counters" id="counters"></div>
      <p>
        <input type="text" id="search" placeholder="Search reference, appliance, issue, ZIP…" aria-label="Search cases">
        <select id="statusFilter" aria-label="Filter by status">
          <option value="all">All statuses</option>
          <option value="new">new</option>
          <option value="reviewing">reviewing</option>
          <option value="contacted">contacted</option>
          <option value="scheduled">scheduled</option>
          <option value="closed">closed</option>
          <option value="cancelled">cancelled</option>
        </select>
      </p>
      <div id="inbox"></div>
      <div id="detail"></div>
    </div>
    <div id="settings" class="hidden"></div>
  </div>
</div>`;
}

export function registerPages(app: express.Express, deps: AppDeps): void {
  app.get("/static/app.css", (_req, res) => {
    res.setHeader("content-type", "text/css");
    res.setHeader("cache-control", "public, max-age=3600");
    res.send(APP_CSS);
  });
  app.get("/static/intake.js", (_req, res) => {
    res.setHeader("content-type", "application/javascript");
    res.setHeader("cache-control", "public, max-age=3600");
    res.send(INTAKE_JS);
  });
  app.get("/static/staff.js", (_req, res) => {
    res.setHeader("content-type", "application/javascript");
    res.setHeader("cache-control", "public, max-age=3600");
    res.send(STAFF_JS);
  });
  app.get("/static/hosted.js", (_req, res) => {
    res.setHeader("content-type", "application/javascript");
    res.setHeader("cache-control", "public, max-age=3600");
    res.send(HOSTED_JS);
  });
  app.get("/widget/v1.js", (_req, res) => {
    res.setHeader("content-type", "application/javascript");
    res.setHeader("cache-control", "public, max-age=3600");
    res.send(WIDGET_JS);
  });

  app.get("/embed", (_req, res) => {
    res.setHeader("content-type", "text/html");
    res.setHeader("content-security-policy", PAGE_CSP);
    res.send(shell({ title: "Service intake", js: "/static/intake.js", body: EMBED_BODY }));
  });

  // Hosted business website generated from tenant configuration (Screen 1).
  app.get("/business/:slug", async (req, res) => {
    const t = await deps.store.getTenantBySlug(req.params.slug);
    if (!t) return res.status(404).send("Unknown business.");
    res.setHeader("content-type", "text/html");
    res.setHeader("content-security-policy", PAGE_CSP);
    const contactAlt = t.contact.phone
      ? `Call us at ${esc(t.contact.phone)}.`
      : t.contact.email ? `Email us at ${esc(t.contact.email)}.` : "Direct contact details to be supplied.";
    res.send(shell({
      title: `${t.name} — appliance service`,
      body: `
<div class="page">
  <div class="demo-banner">${esc(t.demoLabel)}. Demo site — details are placeholders until the business supplies real information.</div>
  <p class="muted">${esc(t.name)}</p>
  <h1>Tell us what's wrong. We'll help prepare your repair.</h1>
  <p>Answer a few questions about your appliance. The service team reviews every request before acting — nothing here books or confirms a visit by itself.</p>
  <p><button id="start" class="btn btn-primary" type="button">Start a service request</button></p>
  <div class="card">
    <h2>What we service</h2>
    <p>Appliance categories: ${esc(t.categories.join(", "))}.</p>
    <p class="muted">We accept service requests across appliance brands. Model-specific guidance depends on available documentation.</p>
    <h2>Service area</h2>
    <p>${t.serviceZips ? `Selected ZIP codes: ${esc(t.serviceZips.join(", "))}.` : "Contact us to confirm coverage for your area."}</p>
  </div>
  <div class="card">
    <h2>How it works</h2>
    <p>1. Describe the problem. 2. Provide details and photos. 3. The team follows up.</p>
    <p class="muted">${esc(t.privacyText)}</p>
    <p class="muted">Prefer not to use the form? ${esc(contactAlt)}</p>
  </div>
  <div data-intake-inline></div>
</div>
<script src="/widget/v1.js" data-public-key="${esc(t.publicKey)}" data-mode="inline" defer></script>
<script src="/static/hosted.js" defer></script>`,
    }));
  });

  app.get("/staff", (_req, res) => {
    res.setHeader("content-type", "text/html");
    res.setHeader("content-security-policy", PAGE_CSP);
    res.send(shell({ title: "Staff workspace", js: "/static/staff.js", body: staffBody() }));
  });

  // Demo partner page. For a genuinely separate origin, serve the equivalent
  // snippet from another host/port (see examples/integration/embed.html).
  app.get("/demo-site", async (_req, res) => {
    const tenants = await deps.store.listTenants();
    const t = tenants[1] ?? tenants[0];
    res.setHeader("content-type", "text/html");
    res.setHeader("content-security-policy", PAGE_CSP);
    res.send(shell({
      title: "Demo partner site",
      body: `
<div class="page">
  <div class="demo-banner">DEMONSTRATION partner page on the same server. It embeds the intake widget for ${t ? esc(t.name) : "?"}.</div>
  <h1>Demo Partner Appliances</h1>
  <p>This page simulates a partner website. A genuine cross-origin check serves this same snippet from a separate host origin.</p>
</div>
<script src="/widget/v1.js" data-public-key="${t ? esc(t.publicKey) : ""}" data-mode="launcher" defer></script>`,
    }));
  });
}
