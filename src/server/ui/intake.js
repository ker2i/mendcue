// MendCue intake client (iframe). Text-only rendering using text nodes.
(function () {
  "use strict";
  var qs = new URLSearchParams(location.search);
  var tenantSlug = qs.get("tenant") || "";
  var publicKey = qs.get("pk") || "";
  var PLATFORM = location.origin;
  var storeKey = "mendcue:" + tenantSlug;

  var els = {};
  ["biz", "privacy", "fixture", "log", "status", "in", "send", "photo", "uploadBtn",
   "humanBtn", "reviewBtn", "steps", "consentBox", "consentNote", "detailsBox",
   "detailsBody", "cardBox", "reviewBox", "reviewBody", "photoPreview", "demoBanner"
  ].forEach(function (id) { els[id] = document.getElementById(id); });

  var S = { token: null, caseId: null, config: null, state: null, pending: false, bootstrapped: false };

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function notify(kind) { try { window.parent.postMessage({ scope: "mendcue", kind: kind }, "*"); } catch (e) {} }
  function setStatus(t) { els.status.textContent = t || ""; }

  function say(role, text) {
    var wrap = el("div", null, role === "c" ? "msg msg-c" : "msg msg-a");
    wrap.appendChild(el("div", text, "bubble"));
    els.log.appendChild(wrap);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    if (S.token) opts.headers.authorization = "Bearer " + S.token;
    return fetch(PLATFORM + path, opts);
  }

  function saveSession() {
    try { sessionStorage.setItem(storeKey, JSON.stringify({ token: S.token, caseId: S.caseId })); } catch (e) {}
  }
  function loadSession() {
    try {
      var raw = sessionStorage.getItem(storeKey);
      if (!raw) return false;
      var o = JSON.parse(raw);
      if (!o.token || !o.caseId) return false;
      S.token = o.token; S.caseId = o.caseId;
      return true;
    } catch (e) { return false; }
  }
  function dropSession() { try { sessionStorage.removeItem(storeKey); } catch (e) {} }

  function stepsFor(state) {
    var facts = {};
    (state.facts || []).forEach(function (f) { facts[f.key] = f.value; });
    var steps = [
      { id: "appliance", label: "Appliance", done: !!facts.appliance_category },
      { id: "problem", label: "Problem", done: !!facts.problem_description },
      { id: "details", label: "Details", done: !!(facts.brand || facts.model_number || facts.service_zip) },
      { id: "review", label: "Review", done: state.case.conversationPhase === "review" || state.case.conversationPhase === "submitted" },
    ];
    clear(els.steps);
    steps.forEach(function (st, i) {
      var s = el("span", (i + 1) + ". " + st.label + (st.done ? " ✓" : ""), st.done ? "on" : null);
      els.steps.appendChild(s);
    });
  }

  function renderDetails(state) {
    clear(els.detailsBody);
    var show = ["appliance_category", "brand", "model_number", "service_zip", "error_code", "contact_channel", "preferred_window"];
    var map = {};
    (state.facts || []).forEach(function (f) { map[f.key] = f.value; });
    var any = false;
    show.forEach(function (k) {
      if (map[k] === undefined || map[k] === null || map[k] === "") return;
      any = true;
      els.detailsBody.appendChild(el("div", k.replace(/_/g, " ") + ": " + map[k]));
    });
    if (!any) els.detailsBody.appendChild(el("div", "Nothing collected yet.", "muted"));
  }

  function quickReplies() {
    // Contextual quick replies based on the latest assistant question.
    var msgs = (S.state && S.state.messages) || [];
    var last = null;
    for (var i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant") { last = msgs[i].body; break; }
    }
    var box = document.getElementById("quickBox");
    clear(box);
    if (!last) return;
    var opts = [];
    if (/which appliance/i.test(last)) opts = ["Refrigerator", "Washer", "Dishwasher", "Other"];
    else if (/ZIP/i.test(last)) opts = [];
    else if (/brand|model|old/i.test(last)) opts = ["I don't know", "Skip"];
    else if (/correct\?|confirm the exact model/i.test(last)) opts = ["Yes", "No", "Label inaccessible"];
    else opts = ["Not sure", "Skip", "Talk to a person"];
    opts.forEach(function (o) {
      var b = el("button", o);
      b.type = "button";
      b.onclick = function () {
        if (o === "Talk to a person") { requestHuman(); return; }
        els.in.value = o;
        send();
      };
      box.appendChild(b);
    });
  }

  function render(resumed) {
    var st = S.state;
    if (!st) return;
    stepsFor(st);
    renderDetails(st);
    if (resumed) {
      clear(els.log);
      (st.messages || []).forEach(function (m) { say(m.role === "customer" ? "c" : "a", m.body); });
    }
    els.fixture.textContent = st.fixtureNotice || "";
    quickReplies();
    renderCard(st);
    if (st.case.conversationPhase === "review") loadReview();
    else { els.reviewBox.style.display = "none"; }
    if (st.case.conversationPhase === "submitted") showSubmitted(st);
  }

  function renderCard(st) {
    clear(els.cardBox);
    var p = st.case.pendingAction;
    if (!p || p.kind !== "model_confirm") return;
    var card = el("div", null, "label-card");
    card.appendChild(el("div", "Confirm the model number from your label photo:"));
    var input = document.createElement("input");
    input.type = "text"; input.value = p.modelRaw || ""; input.setAttribute("aria-label", "Model number");
    card.appendChild(input);
    var row = el("div", null, "quick");
    var yes = el("button", "Confirm");
    yes.onclick = function () { confirmModel(true, input.value); };
    var no = el("button", "Not correct");
    no.onclick = function () { confirmModel(false, null); };
    row.appendChild(yes); row.appendChild(no);
    card.appendChild(row);
    els.cardBox.appendChild(card);
  }

  function confirmModel(confirm, corrected) {
    setStatus("Confirming…");
    var body = { confirm: confirm };
    if (corrected) body.correctedModel = corrected;
    api("/api/v1/cases/" + S.caseId + "/confirm-model", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }).then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
      .then(function (o) {
        if (o.j.confirmed) { say("a", "Thanks — model recorded as " + o.j.model + "."); refresh(); }
        else if (!confirm) { say("a", "No problem — type the model exactly as shown, or say \"label inaccessible\"."); refresh(); }
        else say("a", (o.j.error && o.j.error.message) || "That value was not accepted.");
        setStatus("");
      })
      .catch(function () { setStatus("Network error — retry."); });
  }

  function loadReview() {
    api("/api/v1/cases/" + S.caseId + "/review").then(function (r) { return r.json(); })
      .then(function (rev) {
        els.reviewBox.style.display = "block";
        clear(els.reviewBody);
        rev.sections.forEach(function (sec) {
          var box = el("div", null, "rev-section");
          box.appendChild(el("h3", sec.title));
          sec.rows.forEach(function (row) {
            var r2 = el("div", null, "rev-row");
            r2.appendChild(el("span", row.label, "rev-label"));
            var val = row.value === null || row.value === undefined || row.value === ""
              ? el("span", "Missing", "rev-missing")
              : el("span", String(row.value), "rev-val");
            r2.appendChild(val);
            var edit = el("button", "Edit", "btn rev-edit");
            edit.onclick = function () { editRow(rev, row, r2); };
            r2.appendChild(edit);
            box.appendChild(r2);
          });
          els.reviewBody.appendChild(box);
        });
        var miss = rev.missing && rev.missing.length
          ? "Missing required: " + rev.missing.join(", ") + "."
          : "All required details are present.";
        els.reviewBody.appendChild(el("p", miss, rev.missing && rev.missing.length ? "rev-missing" : "muted"));
        var sendBtn = el("button", "Send request to " + rev.businessName, "btn btn-primary");
        sendBtn.onclick = function () { submit(false); };
        els.reviewBody.appendChild(sendBtn);
        if (rev.requiresIncompleteAck) {
          var note = el("p", "Some required details are missing. You can still send an incomplete request.", "muted");
          els.reviewBody.appendChild(note);
          var inc = el("button", "Send incomplete request", "btn");
          inc.onclick = function () { submit(true); };
          els.reviewBody.appendChild(inc);
        }
        els.reviewBody.appendChild(el("p", "The " + rev.queue + " will follow up. Scheduling is confirmed by the service team.", "muted"));
      })
      .catch(function () { setStatus("Could not load the review — retry."); });
  }

  function editRow(rev, row, container) {
    clear(container);
    container.appendChild(el("span", row.label, "rev-label"));
    var input = document.createElement("input");
    input.type = "text";
    input.value = row.value === null || row.value === undefined ? "" : String(row.value);
    container.appendChild(input);
    var save = el("button", "Save", "btn rev-edit");
    save.onclick = function () {
      api("/api/v1/cases/" + S.caseId + "/facts", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: row.key, value: input.value, version: S.state.case.version }),
      }).then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
        .then(function (o) {
          if (!o.r.ok) { say("a", (o.j.error && o.j.error.message) || "Save failed."); return; }
          refresh().then(loadReview);
        });
    };
    var cancel = el("button", "Cancel", "btn rev-edit");
    cancel.onclick = function () { loadReview(); };
    container.appendChild(save);
    container.appendChild(cancel);
  }

  function submit(ack) {
    setStatus("Sending…");
    api("/api/v1/cases/" + S.caseId + "/submit", {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": "ui-" + Date.now() },
      body: JSON.stringify({ acknowledgeIncomplete: !!ack }),
    }).then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
      .then(function (o) {
        setStatus("");
        if (!o.r.ok) {
          say("a", (o.j.error && o.j.error.message) || "Send failed." + (o.j.missing ? " Missing: " + o.j.missing.join(", ") : ""));
          return;
        }
        refresh().then(function () { showSubmitted(S.state, o.j.reference); });
        notify("intake.submitted");
      })
      .catch(function () { setStatus("Network error — your input is kept; retry."); });
  }

  function showSubmitted(st, ref) {
    els.reviewBox.style.display = "block";
    clear(els.reviewBody);
    var c = st.case;
    els.reviewBody.appendChild(el("h3", "Request sent"));
    els.reviewBody.appendChild(el("p", "Your reference is " + (ref || c.reference || "") + "."));
    els.reviewBody.appendChild(el("p", "The service team will follow up. Scheduling is confirmed by the team, not by this chat.", "muted"));
    els.in.disabled = true;
    els.send.disabled = true;
    els.reviewBtn.disabled = true;
  }

  function refresh() {
    return api("/api/v1/cases/" + S.caseId).then(function (r) {
      if (r.status === 401) { dropSession(); needBootstrap("Your session expired. Start over to begin a new request."); return null; }
      return r.json();
    }).then(function (st) {
      if (!st) return null;
      S.state = st;
      render(false);
      stepsFor(st); renderDetails(st); quickReplies(); renderCard(st);
      return st;
    });
  }

  function pollUntil(n, tries) {
    tries = tries === undefined ? 20 : tries;
    if (tries <= 0) { S.pending = false; els.send.disabled = false; setStatus("Still working — new replies will appear automatically."); return; }
    setTimeout(function () {
      api("/api/v1/cases/" + S.caseId).then(function (r) { return r.json(); }).then(function (st) {
        S.state = st;
        var count = (st.messages || []).length;
        if (count > n) {
          render(true);
          S.pending = false; els.send.disabled = false; setStatus("");
          if (st.case.conversationPhase === "review") loadReview();
        } else {
          setStatus("Working…");
          pollUntil(n, tries - 1);
        }
      }).catch(function () { pollUntil(n, tries - 1); });
    }, 2000);
  }

  function send() {
    var body = els.in.value.trim();
    if (!body || S.pending) return;
    S.pending = true;
    els.send.disabled = true;
    var consent = els.consentBox.checked;
    say("c", body);
    var before = (S.state && S.state.messages ? S.state.messages.length : 0) + 1;
    setStatus("Sending…");
    api("/api/v1/cases/" + S.caseId + "/messages", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: body, consent: consent }),
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (o) {
        els.in.value = "";
        if (o.status === 202) { pollUntil(before); return; } // queued mode
        S.pending = false; els.send.disabled = false; setStatus("");
        if (o.j.reply) say("a", o.j.reply);
        else say("a", (o.j.error && o.j.error.message) || "Something went wrong.");
        refresh();
      })
      .catch(function () {
        // Network failure: input is preserved in the field for retry.
        els.in.value = body;
        S.pending = false; els.send.disabled = false;
        setStatus("Network error — your message is kept above. Check your connection and retry.");
      });
  }

  function requestHuman() {
    api("/api/v1/cases/" + S.caseId + "/request-human", { method: "POST" })
      .then(function (r) { return r.json(); })
      .then(function (j) { say("a", j.reply || "Flagged for a person."); refresh(); })
      .catch(function () { setStatus("Network error — retry."); });
  }

  function upload() {
    var f = els.photo.files && els.photo.files[0];
    if (!f) { setStatus("Choose a photo first (JPEG, PNG, or WebP, up to 8 MB)."); return; }
    clear(els.photoPreview);
    try {
      var img = document.createElement("img");
      img.src = URL.createObjectURL(f);
      img.className = "thumb";
      img.alt = "Selected photo preview";
      els.photoPreview.appendChild(img);
    } catch (e) {}
    setStatus("Uploading photo…");
    var fd = new FormData();
    fd.append("photo", f);
    fd.append("kind", "label_photo");
    var before = (S.state && S.state.messages ? S.state.messages.length : 0);
    fetch(PLATFORM + "/api/v1/cases/" + S.caseId + "/attachments", {
      method: "POST", headers: { authorization: "Bearer " + S.token }, body: fd,
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (o) {
        if (o.status === 202) { say("a", o.j.reply || "Photo received — reading the label."); pollUntil(before); return; }
        say("a", o.j.reply || ((o.j.error && o.j.error.message) || "Photo stored."));
        setStatus("");
        refresh();
      })
      .catch(function () { setStatus("Upload failed — retry."); });
  }

  function needBootstrap(msg) {
    say("a", msg);
    var b = el("button", "Start over", "btn");
    b.onclick = function () { dropSession(); notify("intake.restart"); say("a", "Starting a new request…"); };
    els.log.appendChild(b);
  }

  function boot() {
    if (!publicKey) { say("a", "This intake panel was not configured correctly."); return; }
    fetch(PLATFORM + "/api/v1/public/widget-config/" + encodeURIComponent(publicKey))
      .then(function (r) {
        if (!r.ok) throw new Error("config");
        return r.json();
      })
      .then(function (cfg) {
        S.config = cfg;
        els.biz.textContent = cfg.businessName + " — appliance service request";
        els.privacy.textContent = cfg.privacyText || "";
        els.demoBanner.textContent = cfg.demoLabel || "";
        try {
          if (cfg.branding && cfg.branding.primaryColor) {
            document.body.style.setProperty("--primary", cfg.branding.primaryColor);
          }
        } catch (e) {}
        document.title = cfg.businessName + " — service request";
        // Announce readiness, then resume or wait for the bootstrap code.
        notify("intake.booted");
        if (loadSession()) {
          api("/api/v1/cases/" + S.caseId).then(function (r) {
            if (!r.ok) { dropSession(); waitForBootstrap(); return; }
            return r.json();
          }).then(function (st) {
            if (!st) return;
            S.state = st;
            render(true);
            if (!(st.messages || []).length) say("a", cfg.openingMessage);
          }).catch(function () { waitForBootstrap(); });
        } else {
          waitForBootstrap();
          if (cfg.openingMessage) say("a", cfg.openingMessage);
        }
      })
      .catch(function () { say("a", "Intake is unavailable right now."); });
  }

  function waitForBootstrap() {
    function onMsg(ev) {
      // Strictly checked: only our embedding parent may deliver the code,
      // and the code itself is single-use and short-lived server-side.
      if (ev.source !== window.parent) return;
      var d = ev.data || {};
      if (d.scope !== "mendcue-bootstrap" || !d.code || !d.caseId) return;
      window.removeEventListener("message", onMsg);
      exchange(d.code, d.caseId);
    }
    window.addEventListener("message", onMsg);
    // If the host already posted before we listened, ask for a resend.
    notify("intake.booted");
    setTimeout(function () {
      if (!S.bootstrapped && !S.token) needBootstrap("Still waiting for the host page. You can start over to retry.");
    }, 15000);
  }

  function exchange(code, caseId) {
    fetch(PLATFORM + "/api/v1/sessions/exchange", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code }),
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (o) {
        if (o.status !== 200 || !o.j.token) {
          needBootstrap("This intake link expired. Start over to begin a new request.");
          return;
        }
        S.bootstrapped = true;
        S.token = o.j.token;
        S.caseId = o.j.caseId || caseId;
        saveSession();
        notify("intake.bootstrapped");
        setStatus("");
        api("/api/v1/cases/" + S.caseId).then(function (r) { return r.json(); }).then(function (st) {
          S.state = st;
          render(true);
          if (!(st.messages || []).length && S.config.openingMessage) say("a", S.config.openingMessage);
        });
      })
      .catch(function () { needBootstrap("Network error during setup. Start over to retry."); });
  }

  els.send.onclick = send;
  els.in.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  els.humanBtn.onclick = requestHuman;
  els.reviewBtn.onclick = function () { els.in.value = "Done — show my review"; send(); };
  els.uploadBtn.onclick = upload;
  boot();
})();
