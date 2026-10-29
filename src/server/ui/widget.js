// MendCue widget loader v2.
// - Fetches public tenant config, then opens a same-platform iframe.
// - Bootstrap code travels host -> iframe via postMessage (never in the URL).
// - Host events carry no PII. Restart is supported when iframe state is lost.
(function () {
  var s = document.currentScript;
  var key = s && s.getAttribute("data-public-key");
  var mode = (s && s.getAttribute("data-mode")) || "launcher";
  if (!key) { console.error("[mendcue] missing data-public-key"); return; }
  var PLATFORM = new URL(s.src).origin;

  function emit(type) {
    window.dispatchEvent(new CustomEvent(type));
    try { window.parent.postMessage({ scope: "mendcue", kind: type }, "*"); } catch (e) {}
  }

  async function newSession() {
    var res = await fetch(PLATFORM + "/api/v1/public/sessions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey: key, source: "widget" }),
    });
    if (!res.ok) throw new Error("session " + res.status);
    return res.json();
  }

  function frameStyle() {
    if (mode === "inline") return "width:100%;height:720px;border:1px solid #dce3df;border-radius:16px;";
    return "width:min(400px,calc(100vw - 32px));height:min(640px,calc(100vh - 110px));border:1px solid #dce3df;border-radius:16px;background:#fff;";
  }

  async function start(container) {
    var session;
    try {
      session = await newSession();
    } catch (e) {
      emit("intake.error");
      container.textContent = "Intake is unavailable right now. Please try again later or contact the business directly.";
      return;
    }
    var frame = document.createElement("iframe");
    frame.src = session.iframeUrl; // tenant + public key only; NO bootstrap code in URL
    frame.style.cssText = frameStyle();
    frame.setAttribute("title", "Appliance service intake");
    container.appendChild(frame);
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
      btn.textContent = "Request service";
      btn.style.cssText = "position:fixed;bottom:20px;right:20px;padding:14px 20px;border-radius:999px;border:0;background:#0f766e;color:#fff;font-size:16px;cursor:pointer;z-index:9999;min-height:52px;";
      btn.setAttribute("aria-label", "Open service request intake");
      btn.onclick = function () {
        if (document.getElementById("mendcue-frame-wrap")) return;
        var wrap = document.createElement("div");
        wrap.id = "mendcue-frame-wrap";
        wrap.style.cssText = "position:fixed;bottom:84px;right:16px;z-index:9999;";
        document.body.appendChild(wrap);
        start(wrap);
      };
      document.body.appendChild(btn);
    }
  });
})();
