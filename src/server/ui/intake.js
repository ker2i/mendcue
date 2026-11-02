// Customer conversation. Authoritative messages stay on the server; optimistic
// turns use a stable idempotency key and reconcile without rebuilding the thread.
(function () {
  "use strict";
  var qs = new URLSearchParams(location.search);
  var tenantSlug = qs.get("tenant") || "";
  var publicKey = qs.get("pk") || "";
  var PLATFORM = location.origin;
  var storeKey = "mendcue:" + tenantSlug;
  var els = {};
  ["biz", "privacy", "fixture", "log", "status", "in", "send", "photo", "uploadBtn", "attachBtn",
    "humanBtn", "reviewBtn", "newRequestBtn", "steps", "consentBox", "consentNote", "detailsBox", "detailsBody",
    "cardBox", "reviewBox", "reviewBody", "photoPreview", "demoBanner", "conversation", "helpMenu"
  ].forEach(function (id) { els[id] = document.getElementById(id); });
  var S = { token: null, caseId: null, config: null, state: null, ready: false, pending: false,
    bootstrapped: false, turn: null, notices: [], nodes: new Map(), busy: null,
    pollTimer: null, pollGeneration: 0, reviewVersion: null, reviewLoading: false,
    identitySignature: null, bootstrapListener: null, bootstrapTimer: null };

  function el(tag, text, cls) {
    var node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  function clear(node) { node.replaceChildren(); }
  function uid() { return crypto.randomUUID(); }
  function notify(kind) { window.parent.postMessage({ scope: "mendcue", kind: kind }, "*"); }
  function setStatus(text) { els.status.textContent = text || ""; }
  function atBottom() { return els.conversation.scrollHeight - els.conversation.scrollTop - els.conversation.clientHeight < 100; }
  function scrollDown(force) {
    if (!S.state || !(S.state.messages || []).length) { els.conversation.scrollTop = 0; return; }
    if (force || atBottom()) requestAnimationFrame(function () { els.conversation.scrollTop = els.conversation.scrollHeight; });
  }
  function finished() { return S.state && S.state.case.conversationPhase === "submitted"; }
  function autosize() { els.in.style.height = "auto"; els.in.style.height = Math.min(120, els.in.scrollHeight) + "px"; }
  function updateControls() {
    var locked = !S.ready || !!S.busy || S.pending || finished();
    els.send.disabled = locked || !els.in.value.trim();
    els.in.disabled = !S.ready || finished();
    els.newRequestBtn.disabled = !S.ready || !!S.busy || S.pending;
    els.reviewBtn.disabled = locked || !(S.state && S.state.facts.length);
    els.humanBtn.disabled = locked;
    els.uploadBtn.disabled = locked;
    els.attachBtn.disabled = locked;
    els.consentBox.disabled = finished();
    els.log.setAttribute("aria-busy", String(!!S.pending));
    document.querySelectorAll("#quickBox button, #cardBox button, #reviewBody button").forEach(function (b) { b.disabled = b.id === "newRequest" ? !S.ready : locked; });
    var thinking = document.getElementById("thinking");
    if (!thinking) {
      thinking = el("div", null, "typing-indicator"); thinking.id = "thinking";
      thinking.setAttribute("role", "status");
      var dots = el("span", null, "typing-dots"); dots.setAttribute("aria-hidden", "true");
      for (var i = 0; i < 3; i++) dots.appendChild(el("i"));
      thinking.append(dots, el("span", "Working on your reply…")); els.log.after(thinking);
    }
    thinking.hidden = !S.pending;
    if (S.busy && !S.pending) setStatus(S.busy);
  }
  function api(path, opts) {
    opts = opts || {}; opts.headers = opts.headers || {};
    if (S.token) opts.headers.authorization = "Bearer " + S.token;
    opts.signal = AbortSignal.timeout(45000);
    return fetch(PLATFORM + path, opts);
  }
  async function json(response) {
    var data = await response.json();
    if (!response.ok) {
      var error = new Error(data.error && data.error.message || "That didn't go through. Please try again.");
      error.status = response.status; throw error;
    }
    return data;
  }
  function saveSession() {
    try { sessionStorage.setItem(storeKey, JSON.stringify({ token: S.token, caseId: S.caseId, turn: S.turn, draft: els.in.value })); } catch (_) {}
  }
  function loadSession() {
    try {
      var data = JSON.parse(sessionStorage.getItem(storeKey) || "null");
      if (!data || !data.token || !data.caseId) return false;
      S.token = data.token; S.caseId = data.caseId; S.turn = data.turn || null;
      els.in.value = typeof data.draft === "string" ? data.draft.slice(0, 4000) : ""; autosize(); return true;
    } catch (_) { return false; }
  }
  function dropSession() { try { sessionStorage.removeItem(storeKey); } catch (_) {} }
  function messageNode(key, role, text, greeting) {
    var node = S.nodes.get(key);
    if (!node) {
      node = el("div", null, "msg " + (role === "customer" ? "msg-c" : "msg-a") + (greeting ? " greeting" : ""));
      node.append(el("span", role === "customer" ? "You" : "MendCue", "message-author"), el("div", text, "bubble"));
      S.nodes.set(key, node);
    } else if (node.querySelector(".bubble").textContent !== text) node.querySelector(".bubble").textContent = text;
    return node;
  }
  function syncMessages(force) {
    var pinned = force || atBottom();
    var rows = [];
    if (S.config) rows.push({ id: "greeting", role: "assistant", body: S.config.openingMessage, greeting: true });
    var messages = S.state && S.state.messages || [];
    rows = rows.concat(messages);
    if (S.turn && !messages.some(function (m) { return m.id === S.turn.messageId; })) {
      rows.push({ id: S.turn.key, role: "customer", body: S.turn.body });
    }
    rows = rows.concat(S.notices);
    var cursor = els.log.firstElementChild, keep = new Set();
    rows.forEach(function (m) {
      keep.add(m.id);
      var node = messageNode(m.id, m.role, m.body, m.greeting);
      if (node !== cursor) els.log.insertBefore(node, cursor);
      cursor = node.nextElementSibling;
    });
    while (cursor) { var next = cursor.nextElementSibling; cursor.remove(); cursor = next; }
    S.nodes.forEach(function (_, key) { if (!keep.has(key)) S.nodes.delete(key); });
    scrollDown(pinned);
  }
  function say(role, text) {
    S.notices.push({ id: uid(), role: role === "c" ? "customer" : "assistant", body: text });
    syncMessages(true);
  }
  function renderDetails(st) {
    var labels = { appliance_category: "Appliance", brand: "Brand", model_number: "Model", service_zip: "ZIP code", error_code: "Error code", contact_channel: "Contact", preferred_window: "Preferred time" };
    clear(els.detailsBody);
    (st.facts || []).forEach(function (fact) {
      if (labels[fact.key] && fact.value !== null) els.detailsBody.appendChild(el("p", labels[fact.key] + ": " + fact.value));
    });
    if (!els.detailsBody.childNodes.length) els.detailsBody.appendChild(el("p", "Your repair details will appear here as we talk."));
  }
  function quickReplies() {
    clear(document.getElementById("quickBox"));
    if (!S.ready || S.pending || S.busy || finished() || S.state && S.state.case.conversationPhase === "review") return;
    var messages = S.state && S.state.messages || [];
    var last = messages.filter(function (m) { return m.role === "assistant"; }).at(-1);
    var text = last ? last.body : "Which appliance";
    var options = [];
    if (/which appliance/i.test(text)) options = ["Refrigerator", "Washer", "Dishwasher", "Other"];
    else if (/confirm.*model|correct\?/i.test(text)) return; // The identity card owns this decision.
    else if (/brand|model number|how old/i.test(text)) options = ["I'm not sure", "Label inaccessible"];
    else if (/\?$/.test(text.trim()) && !/ZIP|phone|email|name/i.test(text)) options = ["I'm not sure"];
    options.forEach(function (text) {
      var button = el("button", text); button.type = "button";
      button.onclick = function () { send(text); };
      document.getElementById("quickBox").appendChild(button);
    });
  }
  function render() {
    var st = S.state; if (!st) return;
    var pinned = atBottom();
    var warning = document.getElementById("safetyBanner");
    if (!warning) { warning = el("div", null, "safety-banner"); warning.id = "safetyBanner"; warning.setAttribute("role", "alert"); els.conversation.prepend(warning); }
    var urgent = ["emergency", "stop_use", "needs_review"].includes(st.case.safetyStatus);
    warning.hidden = !urgent;
    warning.textContent = st.case.safetyStatus === "emergency" ? "Emergency reported. Leave the area, avoid switches and flames, and contact emergency services and your gas utility from a safe location. This chat is not emergency assistance." : urgent ? "Please stop using the appliance. A person needs to review this safety concern. Do not attempt additional checks." : "";
    els.fixture.hidden = st.modelMode === "live";
    els.fixture.textContent = st.modelMode === "fallback" ? "The AI connection is having trouble. I can still collect the basics for the service team." : "Demonstration mode — these replies use development fixtures.";
    renderDetails(st); syncMessages(false); renderCard(st); quickReplies();
    if (finished()) showSubmitted(st);
    else if (st.case.conversationPhase === "review") loadReview();
    else els.reviewBox.style.display = "none";
    updateControls(); scrollDown(pinned);
  }
  function renderCard(st) {
    var current = {}; (st.facts || []).forEach(function (f) { current[f.key] = f.value; });
    var p = st.case.pendingAction;
    if (finished() || st.case.conversationPhase === "review" || !current.model_number && !current.model_number_raw && !(p && p.kind === "model_confirm")) {
      clear(els.cardBox); S.identitySignature = null; return;
    }
    var signature = JSON.stringify([current.brand, current.model_number, current.model_number_raw, current.serial_number, current.model_confirmed, p]);
    if (S.identitySignature === signature) return;
    S.identitySignature = signature; clear(els.cardBox);
    var card = el("details", null, "label-card"); card.open = !!(p && p.kind === "model_confirm");
    card.appendChild(el("summary", current.model_confirmed ? "Appliance details · confirmed by you" : "Check your appliance details"));
    card.appendChild(el("p", "Please check the label details before they reach your technician. You can leave the serial number blank.", "muted"));
    var photoId = p && p.attachmentId;
    if (photoId) {
      var image = el("img", null, "thumb"); image.alt = "Uploaded appliance label"; card.appendChild(image);
      api("/api/v1/cases/" + S.caseId + "/attachments/" + photoId).then(function (r) { if (!r.ok) throw Error(); return r.blob(); }).then(function (blob) {
        var url = URL.createObjectURL(blob); image.onload = image.onerror = function () { URL.revokeObjectURL(url); }; image.src = url;
      }).catch(function () { image.alt = "Preview unavailable. You can still check the saved details."; });
    }
    function field(label, value) { var wrap = el("label", label), input = el("input"); input.type = "text"; input.value = value || ""; wrap.appendChild(input); card.appendChild(wrap); return input; }
    var brand = field("Brand", current.brand), model = field("Model number", p && p.modelRaw || current.model_number_raw || current.model_number), serial = field("Serial number (optional)", current.serial_number);
    var row = el("div", null, "quick"), yes = el("button", "Confirm details"), no = el("button", "I can't read the label");
    yes.onclick = function () { confirmModel(true, model.value, brand.value, serial.value); };
    no.onclick = function () { confirmModel(false, null); };
    row.append(yes, no); card.appendChild(row); els.cardBox.appendChild(card);
  }
  async function confirmModel(confirm, corrected, brand, serial) {
    if (S.pending || S.busy) return;
    S.busy = "Saving appliance details…"; updateControls();
    try {
      var body = { confirm: confirm, brand: brand, serialNumber: serial }; if (corrected) body.correctedModel = corrected;
      var result = await api("/api/v1/cases/" + S.caseId + "/confirm-model", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(json);
      await refresh();
      say("a", result.confirmed ? "Thank you — I've saved those appliance details for the technician." : "That's okay. Type what you can read, or say ‘label inaccessible’ and we'll continue.");
      setStatus("");
    } catch (_) { setStatus("I couldn't save that. Your entries are still here — please try again."); }
    finally { S.busy = null; updateControls(); }
  }
  async function loadReview() {
    if (S.reviewLoading || S.reviewVersion === S.state.case.version) return;
    S.reviewLoading = true; var version = S.state.case.version, caseId = S.caseId;
    try {
      var rev = await api("/api/v1/cases/" + S.caseId + "/review").then(json);
      if (S.caseId !== caseId || !S.state || finished() || S.state.case.conversationPhase !== "review" || version !== S.state.case.version) return;
      els.reviewBox.style.display = "block"; clear(els.reviewBody);
      rev.sections.forEach(function (section) {
        var box = el("div", null, "rev-section"); box.appendChild(el("h3", section.title));
        var extra = el("details", null, "review-extra"); extra.appendChild(el("summary", "Add optional details"));
        section.rows.forEach(function (row) {
          var optionalBlank = (row.value === null || row.value === undefined || row.value === "") && !(rev.missing || []).includes(row.key);
          var line = el("div", null, "rev-row"); line.appendChild(el("span", row.label, "rev-label"));
          line.appendChild(el("span", row.value === null || row.value === undefined || row.value === "" ? "Not provided" : String(row.value), "rev-val"));
          if (row.editable) { var edit = el("button", "Edit", "btn rev-edit"); edit.onclick = function () { editRow(row, line); }; line.appendChild(edit); }
          (optionalBlank ? extra : box).appendChild(line);
        });
        if (extra.childNodes.length > 1) box.appendChild(extra);
        els.reviewBody.appendChild(box);
      });
      var sendButton = el("button", "Send request to " + rev.businessName, "btn btn-primary"); sendButton.onclick = function () { submit(false); }; els.reviewBody.appendChild(sendButton);
      if (rev.requiresIncompleteAck) {
        els.reviewBody.appendChild(el("p", "A few details are missing. You can add them above or send what you have.", "muted"));
        var incomplete = el("button", "Send with missing details", "btn"); incomplete.onclick = function () { submit(true); }; els.reviewBody.appendChild(incomplete);
      }
      els.reviewBody.appendChild(el("p", "Please check these details before sending. The team will confirm availability and pricing with you.", "muted"));
      S.reviewVersion = version; updateControls(); scrollDown(true);
    } catch (_) { if (S.caseId === caseId) setStatus("I couldn't load your summary. Choose Review request to try again."); }
    finally { if (S.caseId === caseId) S.reviewLoading = false; }
  }
  function editRow(row, container) {
    clear(container); container.appendChild(el("span", row.label, "rev-label"));
    var input = el("input"); input.type = "text"; input.value = row.value == null ? "" : String(row.value); container.appendChild(input); input.focus();
    var save = el("button", "Save", "btn rev-edit");
    save.onclick = async function () {
      save.disabled = true;
      try {
        await api("/api/v1/cases/" + S.caseId + "/facts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: row.key, value: input.value, version: S.state.case.version }) }).then(json);
        S.reviewVersion = null; await refresh();
      } catch (error) { setStatus(error.message || "Your changes couldn't be saved. Please try again."); save.disabled = false; }
    };
    var cancel = el("button", "Cancel", "btn rev-edit"); cancel.onclick = function () { S.reviewVersion = null; loadReview(); };
    container.append(save, cancel);
  }
  async function submit(ack) {
    if (S.pending || S.busy || finished()) return;
    S.busy = "Sending your request…"; updateControls();
    try {
      await api("/api/v1/cases/" + S.caseId + "/submit", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "submit-" + S.caseId }, body: JSON.stringify({ acknowledgeIncomplete: !!ack }) }).then(json);
      await refresh(); notify("intake.submitted"); setStatus(""); scrollDown(true);
    } catch (error) { setStatus(error.message || "I couldn't send your request. Please try again."); }
    finally { S.busy = null; updateControls(); }
  }
  function showSubmitted(st) {
    S.pending = false; S.turn = null; saveSession();
    if (els.reviewBox.dataset.sent === st.case.reference) return;
    els.reviewBox.dataset.sent = st.case.reference; els.reviewBox.style.display = "block"; clear(els.reviewBody);
    els.reviewBody.append(el("h3", "Your request is on its way"), el("p", "Thank you! Your reference is " + st.case.reference + "."), el("p", "The service team will follow up using the contact details you provided. They'll confirm your appointment and pricing with you.", "muted"));
    var restart = el("button", "Start a new request", "btn-primary"); restart.id = "newRequest"; restart.onclick = restartChat; els.reviewBody.appendChild(restart);
    clear(document.getElementById("quickBox")); setStatus("");
  }
  async function refresh() {
    var response = await api("/api/v1/cases/" + S.caseId);
    if (response.status === 401) { dropSession(); S.ready = false; updateControls(); needBootstrap("Your session expired. Start a new request to continue."); throw Error("Session expired"); }
    var st = await json(response); S.state = st; render(); return st;
  }
  function stopPoll() { clearTimeout(S.pollTimer); S.pollTimer = null; S.pollGeneration++; }
  function completeTurn(st) {
    if (!S.turn) return true;
    var messages = st.messages || [], index = messages.findIndex(function (m) { return m.id === S.turn.messageId; });
    return index >= 0 && messages.slice(index + 1).some(function (m) { return m.role === "assistant"; });
  }
  function pollUntil() {
    stopPoll(); var generation = S.pollGeneration;
    async function tick() {
      if (generation !== S.pollGeneration || !S.pending) return;
      try {
        var st = await api("/api/v1/cases/" + S.caseId).then(json);
        if (generation !== S.pollGeneration) return;
        S.state = st;
        if (completeTurn(st) || st.case.conversationPhase === "submitted") {
          S.pending = false; S.turn = null; saveSession(); setStatus(""); render(); return;
        }
        render();
        setStatus(Date.now() - S.turn.createdAt > 45000 ? "This is taking a little longer. I'll keep checking for your reply." : "Working on your reply…");
      } catch (error) {
        if (generation !== S.pollGeneration) return;
        if (error.status === 401) { S.pending = false; S.ready = false; dropSession(); updateControls(); needBootstrap("Your session expired. Start a new request to continue."); return; }
        setStatus("Connection interrupted. Your message is saved; reconnecting…");
      }
      if (generation === S.pollGeneration && S.pending) S.pollTimer = setTimeout(tick, 2000);
    }
    S.pollTimer = setTimeout(tick, 800);
  }
  async function sendPending() {
    if (!S.turn || S.pending || S.busy || !S.ready || finished()) return;
    S.pending = true; S.turn.failed = false; clear(document.getElementById("quickBox"));
    S.notices = []; syncMessages(true); updateControls(); setStatus("Sending…");
    try {
      var response = await api("/api/v1/cases/" + S.caseId + "/messages", {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": S.turn.key },
        body: JSON.stringify({ body: S.turn.body, consent: S.turn.consent }),
      });
      var status = response.status, result = await json(response);
      S.turn.messageId = result.messageId; S.turn.acknowledged = true; saveSession();
      if (status === 202) { setStatus("Working on your reply…"); pollUntil(); return; }
      await refresh();
      S.pending = false; S.turn = null; saveSession(); setStatus(""); render();
    } catch (error) {
      S.pending = false;
      if (S.turn && S.turn.acknowledged) { S.pending = true; pollUntil(); return; }
      if (S.turn) S.turn.failed = true; saveSession();
      setStatus(error.status ? error.message : "Your message hasn't been confirmed. Retry it below — your words are kept.");
      var retry = el("button", "Retry message", "message-retry"); retry.id = "retryMessage";
      retry.onclick = function () { retry.remove(); sendPending(); }; els.status.appendChild(retry);
    } finally { updateControls(); }
  }
  function send(text) {
    if (S.pending || S.busy || !S.ready || finished()) return;
    var body = typeof text === "string" ? text.trim() : els.in.value.trim(); if (!body) return;
    var oldRetry = document.getElementById("retryMessage"); if (oldRetry) oldRetry.remove();
    S.turn = { key: uid(), body: body, consent: els.consentBox.checked, messageId: null, createdAt: Date.now(), acknowledged: false };
    // Clear only at dispatch. A draft typed while waiting is never erased by a reply.
    if (typeof text !== "string") { els.in.value = ""; autosize(); }
    saveSession(); sendPending();
  }
  async function requestHuman() {
    if (S.pending || S.busy || !S.ready || finished()) return;
    els.helpMenu.open = false; S.busy = "Letting the team know…"; updateControls();
    try { await api("/api/v1/cases/" + S.caseId + "/request-human", { method: "POST" }).then(json); await refresh(); setStatus(""); scrollDown(true); }
    catch (_) { setStatus("I couldn't reach the team. Please try again, or call the business directly."); }
    finally { S.busy = null; updateControls(); }
  }
  async function upload() {
    var file = els.photo.files && els.photo.files[0]; if (!file) { els.photo.click(); return; }
    if (S.pending || S.busy || !S.ready || finished()) return;
    if (file.size > 8 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setStatus("Please choose a JPEG, PNG or WebP photo smaller than 8 MB."); els.photo.value = ""; return; }
    els.helpMenu.open = false; S.busy = "Uploading your photo…"; updateControls();
    var form = new FormData(); form.append("photo", file); form.append("kind", "label_photo");
    var beforeIds = new Set((S.state.messages || []).map(function (m) { return m.id; }));
    try {
      var response = await api("/api/v1/cases/" + S.caseId + "/attachments", { method: "POST", body: form });
      var status = response.status, result = await json(response);
      if (status === 202) {
        S.pending = true; S.busy = null; updateControls(); setStatus("Reading your label…");
        // Upload jobs do not have a customer message: poll for a new assistant reply.
        stopPoll(); var generation = S.pollGeneration;
        var tick = async function () {
          if (generation !== S.pollGeneration) return;
          try {
            var st = await refresh();
            if ((st.messages || []).some(function (m) { return m.role === "assistant" && !beforeIds.has(m.id); })) { S.pending = false; setStatus(""); updateControls(); scrollDown(true); return; }
          } catch (_) { setStatus("Your photo is saved. Reconnecting to check the reply…"); }
          if (generation === S.pollGeneration) S.pollTimer = setTimeout(tick, 2000);
        }; S.pollTimer = setTimeout(tick, 1000);
      } else { await refresh(); setStatus(""); scrollDown(true); }
      els.photo.value = "";
    } catch (error) { setStatus(error.message || "Your photo couldn't be uploaded. Please try again."); }
    finally { S.busy = null; updateControls(); }
  }
  function restartChat() {
    stopPoll(); dropSession(); S.token = null; S.caseId = null; S.state = null; S.turn = null;
    S.ready = false; S.pending = false; S.busy = null; S.notices = []; S.reviewVersion = null;
    S.reviewLoading = false; S.identitySignature = null; S.bootstrapped = false; S.focusOnReady = true;
    els.helpMenu.open = false; clear(els.detailsBody); clear(document.getElementById("quickBox"));
    var warning = document.getElementById("safetyBanner"); if (warning) warning.hidden = true;
    delete els.reviewBox.dataset.sent; els.reviewBox.style.display = "none"; clear(els.reviewBody); clear(els.cardBox);
    els.in.value = ""; els.consentBox.checked = false; els.photo.value = ""; clear(els.photoPreview);
    syncMessages(true); autosize(); updateControls(); waitForBootstrap(); setStatus("Connecting…"); notify("intake.restart");
  }
  function needBootstrap(message) {
    S.ready = false; updateControls(); setStatus(message);
    var button = el("button", "Start a new request", "message-retry"); button.id = "restartChat";
    button.onclick = restartChat; els.status.appendChild(button);
  }
  function restoreState(st) {
    S.state = st; S.ready = true; S.bootstrapped = true;
    var consent = st.facts.find(function (f) { return f.key === "consent"; }); if (consent) els.consentBox.checked = consent.value === true;
    if (!finished()) {
      var messages = st.messages || [], last = messages.at(-1);
      if (S.turn && completeTurn(st)) S.turn = null;
      if (!S.turn && last && last.role === "customer") S.turn = { key: uid(), body: last.body, messageId: last.id, acknowledged: true, createdAt: Date.parse(last.createdAt) };
      if (S.turn && S.turn.acknowledged) S.pending = true;
    }
    render(); scrollDown(true); notify("intake.bootstrapped"); saveSession();
    if (S.pending) pollUntil();
    else if (S.turn && S.turn.failed) { setStatus("Your previous message wasn't confirmed. Please retry it."); var retry = el("button", "Retry message", "message-retry"); retry.onclick = function () { sendPending(); }; els.status.appendChild(retry); }
    else setStatus("");
    updateControls();
    if (S.focusOnReady) { S.focusOnReady = false; els.in.focus(); }
  }
  function waitForBootstrap() {
    if (S.bootstrapListener) window.removeEventListener("message", S.bootstrapListener);
    clearTimeout(S.bootstrapTimer);
    S.bootstrapListener = function (event) {
      if (event.source !== window.parent) return;
      var data = event.data || {}; if (data.scope !== "mendcue-bootstrap" || !data.code || !data.caseId) return;
      window.removeEventListener("message", S.bootstrapListener); clearTimeout(S.bootstrapTimer);
      exchange(data.code, data.caseId);
    };
    window.addEventListener("message", S.bootstrapListener); notify("intake.booted");
    S.bootstrapTimer = setTimeout(function () { if (!S.ready) needBootstrap("The connection is taking longer than expected. Please try again."); }, 15000);
  }
  async function exchange(code, caseId) {
    try {
      var result = await api("/api/v1/sessions/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code }) }).then(json);
      S.token = result.token; S.caseId = result.caseId || caseId; S.turn = null; S.notices = []; S.reviewVersion = null; saveSession();
      var st = await api("/api/v1/cases/" + S.caseId).then(json); restoreState(st);
    } catch (_) { needBootstrap("I couldn't connect your chat. Please start a new request."); }
  }
  async function boot() {
    setStatus("Connecting…"); updateControls();
    if (!publicKey) { setStatus("This chat isn't configured. Please contact the business directly."); return; }
    try {
      var config = await api("/api/v1/public/widget-config/" + encodeURIComponent(publicKey)).then(json);
      S.config = config;
      if (!config.openingMessage) config.openingMessage = "Hi! I'm the AI repair assistant for " + config.businessName + ". I'll collect a few details and prepare a clear summary for your technician. Which appliance needs help, and what's happening?";
      els.biz.textContent = config.businessName; els.privacy.textContent = config.privacyText || ""; els.demoBanner.textContent = config.demoLabel || "";
      if (config.branding && /^#[a-fA-F0-9]{6}$/.test(config.branding.primaryColor)) document.body.style.setProperty("--primary", config.branding.primaryColor);
      els.attachBtn.hidden = els.uploadBtn.hidden = !(config.features && config.features.photos);
      document.title = config.businessName + " · Repair assistant"; syncMessages(true);
      if (loadSession()) {
        var response = await api("/api/v1/cases/" + S.caseId);
        if (response.ok) { restoreState(await response.json()); return; }
        if (response.status !== 401 && response.status !== 404) throw Error("Connection interrupted");
        dropSession(); S.token = null; S.turn = null;
      }
      waitForBootstrap();
    } catch (_) { needBootstrap("The chat couldn't connect. Please try again or contact the business directly."); }
  }
  els.newRequestBtn.onclick = function () { if (!els.newRequestBtn.disabled) restartChat(); };
  els.send.onclick = function () { send(); };
  els.in.addEventListener("input", function () { autosize(); updateControls(); if (S.token) saveSession(); });
  els.in.addEventListener("keydown", function (event) { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); } });
  els.humanBtn.onclick = requestHuman;
  els.reviewBtn.onclick = function () { if (S.state.case.conversationPhase === "review") { S.reviewVersion = null; loadReview(); } else send("Done — show my review"); };
  els.attachBtn.onclick = els.uploadBtn.onclick = function () { els.photo.click(); };
  els.photo.addEventListener("change", upload);
  document.addEventListener("click", function (event) { if (!els.helpMenu.contains(event.target)) els.helpMenu.open = false; });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape") { if (els.helpMenu.open) els.helpMenu.open = false; else notify("intake.close"); } });
  window.addEventListener("pagehide", stopPoll);
  boot();
})();
