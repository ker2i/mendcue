// Customer/staff/hosted pages. Plain HTML+JS consuming the same versioned API.
import express from "express";
import type { AppDeps } from "./app.js";

const WIDGET_JS = `
// Appliance Intake widget loader v1 (demo). Modes: launcher | inline.
(function () {
  var s = document.currentScript;
  var key = s && s.getAttribute("data-public-key");
  var mode = (s && s.getAttribute("data-mode")) || "launcher";
  if (!key) { console.error("[intake] missing data-public-key"); return; }
  var host = new URL(s.src).origin;
  var PLATFORM = host;
  function emit(type) {
    window.dispatchEvent(new CustomEvent(type));
    if (window.parent !== window) { try { window.parent.postMessage({ kind: type }, "*"); } catch (e) {} }
  }
  function openIframe(container, session) {
    var frame = document.createElement("iframe");
    frame.src = session.iframeUrl + "&code=" + encodeURIComponent(session.bootstrapCode) + "&case=" + encodeURIComponent(session.caseId);
    frame.style.cssText = mode === "inline"
      ? "width:100%;height:640px;border:1px solid #ddd;border-radius:12px;"
      : "width:380px;height:600px;border:1px solid #ddd;border-radius:12px;";
    frame.setAttribute("title", "Service intake");
    // Strict postMessage check lives in the iframe; host events carry no PII.
    container.appendChild(frame);
    emit("intake.opened");
    window.addEventListener("message", function (ev) {
      if (ev.origin !== PLATFORM) return;
      if (!ev.data || ev.data.scope !== "mendcue") return;
      if (ev.data.kind === "intake.submitted") emit("intake.submitted");
      if (ev.data.kind === "intake.closed") emit("intake.closed");
      if (ev.data.kind === "intake.error") emit("intake.error");
    });
  }
  async function start(container) {
    var res = await fetch(PLATFORM + "/api/v1/public/sessions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey: key, source: "widget" }),
    });
    if (!res.ok) { emit("intake.error"); container.textContent = "Intake unavailable right now."; return; }
    var session = await res.json();
    openIframe(container, session);
  }
  function ready(fn) { if (document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  ready(function () {
    if (mode === "inline") {
      var target = document.querySelector("[data-intake-inline]") || document.body;
      var div = document.createElement("div"); target.prepend(div); start(div);
    } else {
      var btn = document.createElement("button");
      btn.textContent = "Request service";
      btn.style.cssText = "position:fixed;bottom:20px;right:20px;padding:12px 18px;border-radius:999px;border:0;background:#0b5fff;color:#fff;font-size:15px;cursor:pointer;z-index:9999;";
      btn.onclick = function () {
        if (document.getElementById("intake-frame-wrap")) return;
        var wrap = document.createElement("div");
        wrap.id = "intake-frame-wrap";
        wrap.style.cssText = "position:fixed;bottom:76px;right:20px;z-index:9999;background:#fff;border-radius:12px;";
        document.body.appendChild(wrap); start(wrap);
      };
      document.body.appendChild(btn);
    }
  });
})();
`;

function shell(title: string, body: string, extra = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:0 auto;padding:20px;color:#1a1a1a}
.demo{background:#fff3cd;border:1px solid #e0c66a;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:12px}
#log{border:1px solid #ddd;border-radius:12px;padding:12px;min-height:200px;margin:12px 0;white-space:pre-wrap}
.msg-c{margin:8px 0;text-align:right}.msg-a{margin:8px 0}.row{display:flex;gap:8px}
input[type=text]{flex:1;padding:10px}button{padding:10px 14px}small{color:#666}</style>
${extra}</head><body>${body}</body></html>`;
}

const EMBED_HTML = shell("Service intake", `
<div class="demo" id="demo"></div>
<h2 id="biz">Service intake</h2>
<p><small id="privacy"></small></p>
<p><small id="fixture" style="color:#8a5a00"></small></p>
<div id="log" aria-live="polite"></div>
<div class="row">
<input type="text" id="in" placeholder="Type your message…" autocomplete="off">
<button id="send">Send</button>
</div>
<div class="row" style="margin-top:8px">
<input type="file" id="photo" accept="image/jpeg,image/png,image/webp">
<button id="upload">Upload label photo</button>
<button id="human">Talk to a person</button>
<button id="submit">Review &amp; submit</button>
</div>
<script>
(function(){
  var q = new URLSearchParams(location.search);
  var tenantSlug = q.get("tenant"), code = q.get("code"), caseId = q.get("case");
  var token = null, platformOrigin = location.origin;
  var log = document.getElementById("log");
  function say(who, text){ var d=document.createElement("div"); d.className = who==="c"?"msg-c":"msg-a"; d.textContent=(who==="c"?"You: ":"Assistant: ")+text; log.appendChild(d); log.scrollTop=log.scrollHeight; }
  function notify(kind){ try{ window.parent.postMessage({scope:"mendcue",kind:kind}, "*"); }catch(e){} }
  async function boot(){
    // Strict origin discipline: this iframe only talks to its own platform origin.
    var r = await fetch(platformOrigin + "/api/v1/public/widget-config/" + encodeURIComponent(q.get("pk") || ""));
    if(!r.ok && tenantSlug){
      // Fallback: resolve config via bootstrap exchange path using tenant slug page
    }
    if(code){
      var x = await fetch(platformOrigin + "/api/v1/sessions/exchange",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code:code})});
      if(!x.ok){ say("a","This intake link expired. Please reload the page."); return; }
      var s = await x.json(); token = s.token; caseId = s.caseId;
    }
    var st = await fetch(platformOrigin + "/api/v1/cases/" + caseId,{headers:{authorization:"Bearer "+token}});
    var j = await st.json();
    document.getElementById("fixture").textContent = j.fixtureNotice || "";
    (j.messages||[]).forEach(function(m){ say(m.role==="customer"?"c":"a", m.body); });
    if(!(j.messages||[]).length && j.case){ say("a", "Hello — describe your appliance problem to begin. You can ask for a person at any time."); }
  }
  async function send(){
    var el = document.getElementById("in"); var body = el.value.trim(); if(!body) return; el.value="";
    say("c", body);
    var r = await fetch(platformOrigin + "/api/v1/cases/" + caseId + "/messages",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify({body:body})});
    var j = await r.json(); say("a", j.reply || j.error && j.error.message || "(processing…)"); 
  }
  document.getElementById("send").onclick = send;
  document.getElementById("in").addEventListener("keydown",function(e){ if(e.key==="Enter") send(); });
  document.getElementById("human").onclick = async function(){
    var r = await fetch(platformOrigin + "/api/v1/cases/" + caseId + "/request-human",{method:"POST",headers:{authorization:"Bearer "+token}});
    var j = await r.json(); say("a", j.reply || "Flagged for a person.");
  };
  document.getElementById("submit").onclick = async function(){
    var r = await fetch(platformOrigin + "/api/v1/cases/" + caseId + "/submit",{method:"POST",headers:{authorization:"Bearer "+token,"idempotency-key":String(Date.now())}});
    var j = await r.json();
    if(j.reference){ say("a","Submitted. Your reference is "+j.reference+"."); notify("intake.submitted"); }
    else say("a", (j.error&&j.error.message)||"Submit failed.");
  };
  document.getElementById("upload").onclick = async function(){
    var f = document.getElementById("photo").files[0]; if(!f){ say("a","Choose a photo first (JPEG/PNG/WebP, up to 8 MB)."); return; }
    var fd = new FormData(); fd.append("photo", f); fd.append("kind","label_photo");
    var r = await fetch(platformOrigin + "/api/v1/cases/" + caseId + "/attachments",{method:"POST",headers:{authorization:"Bearer "+token},body:fd});
    var j = await r.json(); say("a", j.reply || (j.error&&j.error.message) || "Photo stored.");
  };
  boot();
})();
<\/script>`);

export function registerPages(app: express.Express, deps: AppDeps): void {
  app.get("/widget/v1.js", (_req, res) => {
    res.setHeader("content-type", "application/javascript");
    res.send(WIDGET_JS);
  });

  app.get("/embed", (_req, res) => {
    res.setHeader("content-type", "text/html");
    res.send(EMBED_HTML);
  });

  // Hosted business website generated from tenant config.
  app.get("/business/:slug", async (req, res) => {
    const t = await deps.store.getTenantBySlug(req.params.slug);
    if (!t) return res.status(404).send("Unknown business.");
    const html = shell(`${t.name} — service requests`, `
<div class="demo">${t.demoLabel}. Demo site — details are placeholders until the business supplies real information.</div>
<h1>${t.name}</h1>
<p>Appliance categories: ${t.categories.join(", ")}. Model-specific guidance depends on available documentation.</p>
<p>Service area: ${t.serviceZips ? "Selected ZIP codes (" + t.serviceZips.slice(0, 10).join(", ") + "…)" : "Contact us to confirm coverage"}.</p>
<p>How it works: start a request below, answer a few questions, review the summary, and submit. The service team confirms everything.</p>
<p><button id="start">Start a service request</button> <small>or contact us directly${t.contact.phone ? " at " + t.contact.phone : t.contact.email ? " at " + t.contact.email : " (contact details to be supplied)"}.</small></p>
<p><small>${t.privacyText}</small></p>
<div data-intake-inline></div>
<script src="/widget/v1.js" data-public-key="${t.publicKey}" data-mode="inline" defer><\/script>
<script>document.getElementById("start").onclick=function(){window.scrollTo(0,document.body.scrollHeight);};</script>`);
    res.setHeader("content-type", "text/html");
    res.send(html);
  });

  // Staff dashboard shell (phone-friendly; uses staff API + cookies).
  app.get("/staff", (_req, res) => {
    res.setHeader("content-type", "text/html");
    res.send(shell("Staff dashboard", `
<h1>Staff dashboard</h1>
<div id="login"><h3>Login</h3>
<input type="text" id="slug" placeholder="tenant slug (e.g. demo-phoenix-appliance)"><br><br>
<input type="text" id="email" placeholder="email"><br><br>
<input type="password" id="pw" placeholder="password"><br><br>
<button id="go">Log in</button></div>
<div id="app" style="display:none">
<button id="refresh">Refresh inbox</button> <span id="who"></span>
<div id="inbox"></div>
<div id="detail"></div>
</div>
<script>
var csrf=null;
function getCookie(n){ var m=document.cookie.match(new RegExp(n+"=([^;]+)")); return m?decodeURIComponent(m[1]):null; }
document.getElementById("go").onclick=async function(){
  var r=await fetch("/api/v1/staff/login",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({tenantSlug:document.getElementById("slug").value,email:document.getElementById("email").value,password:document.getElementById("pw").value})});
  var j=await r.json();
  if(!j.ok){ alert(j.error.message); return; }
  csrf=j.csrf; document.getElementById("login").style.display="none"; document.getElementById("app").style.display="block";
  document.getElementById("who").textContent=j.user.name+" ("+j.user.role+")";
  load();
};
async function load(){
  var r=await fetch("/api/v1/staff/cases"); var j=await r.json();
  var box=document.getElementById("inbox"); box.innerHTML="<h3>Inbox ("+j.cases.length+")</h3>";
  j.cases.forEach(function(c){
    var d=document.createElement("div");
    d.innerHTML="<b>"+c.reference+"</b> "+(c.appliance||"?")+" — "+((c.complaint||"").slice(0,80))+" | "+(c.zip||"?")+" | "+c.safetyStatus+" | "+c.workflowStatus+" ";
    var b=document.createElement("button"); b.textContent="Open"; b.onclick=function(){openCase(c.id);};
    d.appendChild(b); box.appendChild(d);
  });
}
document.getElementById("refresh").onclick=load;
async function openCase(id){
  var r=await fetch("/api/v1/staff/cases/"+id); var j=await r.json();
  var d=document.getElementById("detail");
  var h=j.handoffs[j.handoffs.length-1];
  d.innerHTML="<h3>"+j.case.reference+" (v"+j.case.version+")</h3><pre>"+(h?escapeHtml(JSON.stringify(h.snapshot,null,2).slice(0,4000)):"(not submitted yet)")+"</pre>"+
   "<h4>Rate handoff</h4><select id='rating'><option value='useful_as_received'>Useful as received</option><option value='useful_after_corrections'>Useful after minor corrections</option><option value='needed_followup'>Needed substantial follow-up</option><option value='misleading_or_unusable'>Misleading or unusable</option></select>"+
   "<input type='text' id='issue' placeholder='confirmed issue'><button id='saveOutcome'>Save outcome</button>"+
   "<h4>Status</h4><select id='ws'><option>reviewing</option><option>contacted</option><option>scheduled</option><option>closed</option></select><button id='saveWs'>Update</button>";
  function escapeHtml(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;");}
  document.getElementById("saveOutcome").onclick=async function(){
    await fetch("/api/v1/staff/cases/"+id+"/outcome",{method:"POST",headers:{"content-type":"application/json","x-csrf-token":getCookie("staff_csrf")},body:JSON.stringify({rating:document.getElementById("rating").value,confirmedIssue:document.getElementById("issue").value})});
    alert("Outcome saved.");
  };
  document.getElementById("saveWs").onclick=async function(){
    var u=await fetch("/api/v1/staff/cases/"+id,{method:"PATCH",headers:{"content-type":"application/json","x-csrf-token":getCookie("staff_csrf")},body:JSON.stringify({workflowStatus:document.getElementById("ws").value,version:j.case.version})});
    alert(u.ok?"Updated.":"Update failed (refresh)."); load();
  };
}
<\/script>`));
  });

  // Demo external site on another origin (for manual embed testing).
  app.get("/demo-site", async (_req, res) => {
    const tenants = await deps.store.listTenants();
    const t = tenants[1] ?? tenants[0];
    res.setHeader("content-type", "text/html");
    res.send(shell("Demo partner site (second origin)", `
<div class="demo">DEMONSTRATION partner page. Embeds the intake widget for ${t ? t.name : "?"} via cross-origin script + iframe.</div>
<h1>Demo Partner Appliances</h1>
<p>This page simulates a second company's website embedding the same platform.</p>
<script src="/widget/v1.js" data-public-key="${t ? t.publicKey : ""}" data-mode="launcher" defer><\/script>`));
  });
}
