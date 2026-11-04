// Page shells. All styling and behavior live in /static/* (external files)
// so pages can be served under a restrictive Content Security Policy.
// Server-side tenant text is HTML-escaped; clients use textContent only.
import express from "express";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppDeps } from "./app.js";

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), "ui");
const APP_CSS = readFileSync(join(UI_DIR, "app.css"), "utf8");
const WIDGET_JS = readFileSync(join(UI_DIR, "widget.js"), "utf8");
const INTAKE_JS = readFileSync(join(UI_DIR, "intake.js"), "utf8");
const STAFF_JS = readFileSync(join(UI_DIR, "staff.js"), "utf8");
const MOBILE_JS = readFileSync(join(UI_DIR, "staff-mobile.js"), "utf8");
const STAFF_SW = readFileSync(join(UI_DIR, "staff-sw.js"), "utf8");
const HOSTED_JS = readFileSync(join(UI_DIR, "hosted.js"), "utf8");

export const PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; " +
  "img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; " +
  "base-uri 'self'; form-action 'self'";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const ASSET_VERSION = createHash("sha256").update(APP_CSS + INTAKE_JS + STAFF_JS + HOSTED_JS + MOBILE_JS + STAFF_SW).digest("hex").slice(0, 12);

function shell(opts: { title: string; css?: boolean; js?: string; staff?: boolean; customer?: boolean; body: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(opts.title)}</title>
${opts.staff ? '<link rel="manifest" href="/staff/manifest.webmanifest"><meta name="theme-color" content="#102b45"><link rel="icon" href="/staff/icon-192.png">' : ""}
${opts.css === false ? "" : `<link rel="stylesheet" href="${opts.staff ? "/staff/app.css" : "/static/app.css"}?v=${ASSET_VERSION}">`}</head>
<body${opts.customer ? ' class="customer-app"' : ''}>${opts.body}
${opts.js ? `<script src="${opts.js}?v=${ASSET_VERSION}" defer></script>` : ""}
</body></html>`;
}

const EMBED_BODY = `
<div class="sheet chat-sheet">
  <header class="sheet-header chat-header">
    <span class="assistant-mark" aria-hidden="true">✦</span>
    <div class="chat-heading"><div class="biz" id="biz">Repair assistant</div><div class="assistant-subtitle">AI assistant · Powered by MendCue</div></div>
  </header>
  <div class="chat-toolbar">
    <button id="newRequestBtn" class="chat-tool chat-new-request" type="button" aria-label="Start a new repair request" disabled><span aria-hidden="true">＋</span> New request</button>
    <button id="reviewBtn" class="chat-tool" type="button" disabled>Review request <span class="review-arrow" aria-hidden="true">↗</span></button>
    <details class="chat-menu" id="helpMenu"><summary aria-label="More options"><span class="chat-menu-label">More</span> <span class="chat-menu-icon" aria-hidden="true">⋯</span></summary>
      <div class="chat-menu-panel"><button id="humanBtn" type="button" disabled>Ask for a person</button><button id="uploadBtn" type="button" disabled>Attach a label photo</button>
      <details class="collected" id="detailsBox"><summary>Your repair details</summary><div id="detailsBody"></div></details>
      <details class="privacy-info"><summary>About this assistant & privacy</summary><p id="privacy"></p><p id="demoBanner" class="demo-banner"></p><div id="steps" class="steps" aria-label="Progress"></div></details></div>
    </details>
  </div>
  <div class="conversation" id="conversation">
    <div id="fixture" class="chat-notice" hidden></div>
    <main class="log" id="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text"></main>
    <div id="cardBox"></div>
    <section id="reviewBox" class="hidden chat-review" aria-label="Review your request"><h2>Review your request</h2><div id="reviewBody"></div></section>
    <div class="quick chat-suggestions" id="quickBox"></div>
  </div>
  <footer class="chat-footer">
    <div class="statusbar" id="status" role="status"></div>
    <div id="photoPreview"></div>
    <div class="consent"><label><input type="checkbox" id="consentBox"> Share my repair details with the service team.</label><span id="consentNote" class="muted"></span></div>
    <div class="composer">
      <input type="file" id="photo" class="visually-hidden" accept="image/jpeg,image/png,image/webp" aria-label="Label photo">
      <button id="attachBtn" class="attach-button" type="button" aria-label="Attach a label photo" title="Attach a label photo" disabled>+</button>
      <textarea id="in" rows="1" maxlength="4000" placeholder="Type your message…" aria-label="Message" disabled></textarea>
      <button id="send" class="send-button" type="button" aria-label="Send message" title="Send message" disabled>↑</button>
    </div>
    <p class="chat-footnote">AI helps collect details. A person confirms your repair.</p>
  </footer>
</div>`;

function staffBody(): string {
  return `
<div class="page technician-app">
  <h1>MendCue Technician</h1>
  <p id="sessionLoading" role="status">Checking your session…</p>
  <div id="login" class="card hidden">
    <h2>Technician sign in</h2>
    <label for="slug">Business</label>
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
      <button id="tabCalendar" class="btn" type="button">Schedule</button>
      <button id="installApp" class="btn" type="button">Install app</button>
      <button id="tabSettings" class="btn" type="button">Settings</button>
      <button id="refresh" class="btn" type="button">Refresh</button>
      <button id="logout" class="btn" type="button">Log out</button>
    </p>
    <div id="inboxPane">
      <div class="counters" id="counters"></div>
      <p>
        <input type="text" id="search" placeholder="Search reference, appliance, issue, ZIP…" aria-label="Search cases">
        <select id="statusFilter" aria-label="Filter by status">
          <option value="new">New requests</option>
          <option value="active">Active jobs</option>
          <option value="all">All requests</option>
          <option value="draft">Customer drafts</option>
          <option value="reviewing">reviewing</option>
          <option value="contacted">contacted</option>
          <option value="scheduled">scheduled</option>
          <option value="closed">closed</option>
          <option value="cancelled">cancelled</option>
        </select>
      </p>
      <div id="inbox"></div>
      <button id="backInbox" class="btn phone-back hidden" type="button">Back to inbox</button>
      <div id="detail"></div>
    </div>
    <p id="appNotice" role="status" class="muted"></p>
    <div id="calendar" class="hidden"></div>
    <div id="deviceSettings"></div>
    <div id="settings" class="hidden"></div>
  </div>
</div>`;
}

export function registerPages(app: express.Express, deps: AppDeps): void {
  app.get("/static/app.css", (_req, res) => {
    res.setHeader("content-type", "text/css");
    res.setHeader("cache-control", "no-cache");
    res.send(APP_CSS);
  });
  app.get("/static/intake.js", (_req, res) => {
    res.setHeader("content-type", "application/javascript");
    res.setHeader("cache-control", "no-cache");
    res.send(INTAKE_JS);
  });
  app.get("/static/staff.js", (_req, res) => {
    res.setHeader("content-type", "application/javascript");
    res.setHeader("cache-control", "no-cache");
    res.send(STAFF_JS);
  });
  app.get("/static/hosted.js", (_req, res) => {
    res.setHeader("content-type", "application/javascript");
    res.setHeader("cache-control", "no-cache");
    res.send(HOSTED_JS);
  });
  app.get("/widget/v1.js", (_req, res) => {
    res.setHeader("content-type", "application/javascript");
    res.setHeader("cache-control", "no-cache");
    res.send(WIDGET_JS);
  });

  app.get("/embed", (_req, res) => {
    res.setHeader("content-type", "text/html");
    res.setHeader("content-security-policy", PAGE_CSP);
    res.send(shell({ title: "Service intake", customer: true, js: "/static/intake.js", body: EMBED_BODY }));
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
      customer: true,
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

  app.get("/staff", (req, res) => {
    if(req.path==="/staff")return res.redirect(308,"/staff/"+req.originalUrl.slice("/staff".length));
    res.setHeader("content-type", "text/html");res.setHeader("cache-control","no-store");
    res.setHeader("content-security-policy", PAGE_CSP+"; worker-src 'self'; manifest-src 'self'");
    res.send(shell({ title: "MendCue Technician", staff:true, js: "/staff/app.js", body: staffBody() }));
  });
  app.get("/staff/manifest.webmanifest",(_req,res)=>res.type("application/manifest+json").set("Cache-Control","no-cache").json({id:"/staff/",name:"MendCue Technician",short_name:"MendCue",start_url:"/staff/",scope:"/staff/",display:"standalone",background_color:"#f4f7fa",theme_color:"#102b45",icons:[192,512].map(size=>({src:`/staff/icon-${size}.png`,sizes:`${size}x${size}`,type:"image/png",purpose:"any maskable"}))}));
  app.get("/staff/app.css",(_req,res)=>res.type("css").set("Cache-Control","no-cache").send(APP_CSS));
  app.get("/staff/app.js",(_req,res)=>res.type("application/javascript").set("Cache-Control","no-cache").send(MOBILE_JS.replaceAll("__APP_VERSION__",ASSET_VERSION)+"\n"+STAFF_JS));
  app.get("/staff/sw.js",(_req,res)=>res.type("application/javascript").set("Cache-Control","no-store").set("Service-Worker-Allowed","/staff/").send(STAFF_SW.replaceAll("__APP_VERSION__",ASSET_VERSION)));
  app.get("/staff/icon-:size.png",(req,res)=>{
    if(!["192","512"].includes(req.params.size))return res.sendStatus(404);
    res.type("png").send(readFileSync(join(UI_DIR,`icon-${req.params.size}.png`)));
  });
  app.get("/staff/offline.html",(_req,res)=>res.type("html").set("Cache-Control","no-cache").set("Content-Security-Policy",PAGE_CSP).send(shell({title:"MendCue · Offline",staff:true,body:'<main class="sheet"><h1>You’re offline</h1><p>Reconnect to view your inbox and save changes. Unsent notes on this phone will be restored after sign-in.</p><a href="/staff/">Try connecting again</a></main>'})));

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
