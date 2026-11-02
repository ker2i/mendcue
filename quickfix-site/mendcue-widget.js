// MendCue widget loader v2.
// - Fetches public tenant config, then opens a same-platform iframe.
// - Bootstrap code travels host -> iframe via postMessage (never in the URL).
// - Host events carry no PII. Restart is supported when iframe state is lost.
(function () {
  var s = document.currentScript;
  var key = s && s.getAttribute("data-public-key");
  var mode = (s && s.getAttribute("data-mode")) || "launcher";
  if (!key) { console.error("[mendcue] missing data-public-key"); return; }
  var PLATFORM = new URL(s.getAttribute("data-platform") || s.src).origin;
  var color = s.getAttribute("data-color") || "#0f766e";
  if (!/^#[a-fA-F0-9]{6}$/.test(color)) color = "#0f766e";
  var label = s.getAttribute("data-label") || "Request service";

  function emit(type) {
    window.dispatchEvent(new CustomEvent(type));
    try { window.parent.postMessage({ scope: "mendcue", kind: type }, "*"); } catch (e) {}
  }

  async function newSession() {
    var res = await fetch(PLATFORM + "/api/v1/public/sessions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey: key, source: "widget" }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error("session " + res.status);
    return res.json();
  }

  function frameStyle() {
    if (mode === "inline") return "display:block;width:100%;height:740px;max-height:92dvh;border:1px solid #e8ecef;border-radius:24px;background:#fff;";
    return "display:block;width:100%;height:100%;border:0;border-radius:24px;background:#fff;";
  }

  async function start(container) {
    var session;
    container.replaceChildren();
    container.setAttribute("aria-busy", "true");
    container.textContent = "Connecting to the repair assistant…";
    try {
      session = await newSession();
    } catch (e) {
      emit("intake.error");
      container.replaceChildren();
      container.setAttribute("aria-busy", "false");
      var message = document.createElement("p");
      message.setAttribute("role", "status");
      message.textContent = "Intake is unavailable right now. Call the business or try again.";
      var retry = document.createElement("button");
      retry.textContent = "Try again";
      retry.onclick = function () { start(container); };
      container.append(message, retry);
      return;
    }
    container.replaceChildren();
    container.setAttribute("aria-busy", "false");
    var frame = document.createElement("iframe");
    frame.src = session.iframeUrl; // tenant + public key only; NO bootstrap code in URL
    frame.style.cssText = frameStyle();
    frame.setAttribute("title", "Appliance service intake");
    container.appendChild(frame);
    if (mode !== "inline") { container.style.height = "100%"; container.style.padding = "0"; }
    emit("intake.opened");
    var hello = { scope: "mendcue-bootstrap", code: session.bootstrapCode, caseId: session.caseId };
    var delivered = false;
    function sendHello() {
      if (delivered) return;
      try { frame.contentWindow.postMessage(hello, PLATFORM); } catch (e) {}
    }
    frame.addEventListener("load", function () { sendHello(); setTimeout(sendHello, 800); });
    setTimeout(sendHello, 1500);
    window.addEventListener("message", function (ev) {
      if (ev.origin !== PLATFORM) return;
      if (ev.source !== frame.contentWindow) return; // strictly checked source
      if (!ev.data || ev.data.scope !== "mendcue") return;
      if (ev.data.kind === "intake.booted") { sendHello(); }
      else if (ev.data.kind === "intake.bootstrapped") { delivered = true; }
      else if (ev.data.kind === "intake.submitted") emit("intake.submitted");
      else if (ev.data.kind === "intake.close") window.dispatchEvent(new Event("mendcue.close"));
      else if (ev.data.kind === "intake.closed") emit("intake.closed");
      else if (ev.data.kind === "intake.error") emit("intake.error");
      else if (ev.data.kind === "intake.restart") {
        // Iframe lost its session (reload with expired bootstrap): mint fresh.
        newSession().then(function (ns) {
          hello = { scope: "mendcue-bootstrap", code: ns.bootstrapCode, caseId: ns.caseId };
          delivered = false;
          sendHello();
        }, function () { emit("intake.error"); });
      }
    });
  }

  function ready(fn) { if (document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  ready(function () {
    if (mode === "inline") {
      var target = document.querySelector("[data-intake-inline]") || document.body;
      var div = document.createElement("div");
      target.prepend(div);
      start(div);
    } else {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.style.cssText = "position:fixed;bottom:20px;right:20px;padding:14px 20px;border-radius:999px;border:0;color:#fff;font-size:16px;cursor:pointer;z-index:9999;min-height:52px;";
      btn.style.backgroundColor = color;
      btn.setAttribute("aria-label", "Open service request intake");
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-controls", "mendcue-frame-wrap");
      var wrap, close, returnFocus;
      function hide() {
        if (!wrap || wrap.hidden) return;
        wrap.hidden = true;
        btn.hidden = false;
        btn.setAttribute("aria-expanded", "false");
        if (returnFocus && returnFocus.isConnected) returnFocus.focus();
      }
      function layout() {
        if (!wrap) return;
        var viewport = window.visualViewport;
        var height = viewport ? viewport.height : window.innerHeight;
        var offset = viewport ? viewport.offsetTop : 0;
        var mobile = window.innerWidth <= 560;
        if (mobile) {
          wrap.style.width = "calc(100vw - 16px)";
          wrap.style.height = Math.max(200, height - 16) + "px";
          wrap.style.right = "8px";
          wrap.style.top = offset + 8 + "px";
          wrap.style.bottom = "auto";
        } else {
          wrap.style.width = "448px";
          wrap.style.height = Math.max(240, Math.min(740, height - 112)) + "px";
          wrap.style.right = "24px";
          wrap.style.top = "auto";
          wrap.style.bottom = "88px";
        }
      }
      window.addEventListener("resize", layout);
      if (window.visualViewport) { window.visualViewport.addEventListener("resize", layout); window.visualViewport.addEventListener("scroll", layout); }
      function open() {
        if (wrap && !wrap.hidden) return;
        returnFocus = document.activeElement;
        if (!wrap) {
          wrap = document.createElement("section");
          wrap.id = "mendcue-frame-wrap";
          wrap.setAttribute("aria-label", "Repair request assistant");
          wrap.style.cssText = "position:fixed;z-index:9999;background:white;color:#102b45;border-radius:24px;box-shadow:0 20px 80px #102b4533;max-width:calc(100vw - 16px);overflow:hidden;";
          close = document.createElement("button");
          close.type = "button";
          close.textContent = "×";
          close.setAttribute("aria-label", "Close assistant");
          close.title = "Close assistant";
          close.style.cssText = "position:absolute;top:14px;right:12px;z-index:2;width:36px;height:36px;border-radius:50%;border:0;background:#f3f6f8;color:#526777;font-size:24px;line-height:1;cursor:pointer;";
          close.onclick = hide;
          var content = document.createElement("div");
          content.style.cssText = "width:100%;height:100%;padding:24px;font:14px system-ui;";
          wrap.append(close, content);
          document.body.appendChild(wrap);
          start(content);
        }
        layout();
        wrap.hidden = false;
        btn.hidden = true;
        btn.setAttribute("aria-expanded", "true");
        close.focus();
      }
      btn.onclick = function () { if (wrap && !wrap.hidden) hide(); else open(); };
      window.addEventListener("mendcue.open", open);
      window.addEventListener("mendcue.close", hide);
      window.addEventListener("keydown", function (event) { if (event.key === "Escape") hide(); });
      document.body.appendChild(btn);
    }
  });
})();
