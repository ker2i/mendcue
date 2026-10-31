// MendCue staff workspace. Text-only rendering using text nodes.
(function () {
  "use strict";
  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function cookie(n) {
    var m = document.cookie.match(new RegExp(n + "=([^;]+)"));
    return m ? decodeURIComponent(m[1]) : "";
  }
  function csrf() { return { "content-type": "application/json", "x-csrf-token": cookie("staff_csrf") }; }

  var S = { user: null, tenant: null, cases: [], openId: null, detail: null, tab: "inbox" };
  function changeReviewTimer(detail, action) {
    if (detail.timerRequest) return detail.timerRequest;
    detail.timerRequest = fetch("/api/v1/staff/cases/" + detail.case.id + "/review-timer", {
      method: "POST", keepalive: true, headers: csrf(), body: JSON.stringify({version: detail.case.version, action: action})
    }).then(function(r) {
      if (!r.ok) throw Error("Timer could not be updated. Refresh this case before recording measured effort.");
      return r.json();
    }).then(function(x) {
      detail.case.version = x.version;
      detail.reviewTimer = x.timer;
      detail.timerError = "";
    }).catch(function(e) { detail.timerError = e.message; }).finally(function() {
      detail.timerRequest = null;
      if (detail.refreshTimer) detail.refreshTimer();
    });
    if (detail.refreshTimer) detail.refreshTimer();
    return detail.timerRequest;
  }
  function pauseActiveReview() {
    var detail = S.detail;
    if (!detail) return Promise.resolve();
    return Promise.resolve(detail.timerRequest).then(function() {
      if (detail.reviewTimer && detail.reviewTimer.startedAt) return changeReviewTimer(detail, "pause");
    });
  }
  document.addEventListener("visibilitychange",function(){if(document.visibilityState==="hidden")pauseActiveReview();});
  window.addEventListener("pagehide",pauseActiveReview);
  var loginBox = document.getElementById("login");
  var appBox = document.getElementById("app");

  function login() {
    var slug = document.getElementById("slug").value.trim();
    var email = document.getElementById("email").value.trim();
    var pw = document.getElementById("pw").value;
    fetch("/api/v1/staff/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantSlug: slug, email: email, password: pw }),
    }).then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
      .then(function (o) {
        if (!o.r.ok) { alert((o.j.error && o.j.error.message) || "Login failed."); return; }
        S.user = o.j.user; S.tenant = o.j.tenant;
        loginBox.style.display = "none";
        appBox.style.display = "block";
        document.getElementById("who").textContent = o.j.user.name + " (" + o.j.user.role + ") — " + o.j.tenant;
        loadInbox();
        if (location.hash.startsWith("#case=")) openCase(decodeURIComponent(location.hash.slice(6)));
      });
  }

  function counters(cases) {
    var box = document.getElementById("counters");
    clear(box);
    var nNew = cases.filter(function (c) { return c.workflowStatus === "new"; }).length;
    var nRev = cases.filter(function (c) { return c.safetyStatus === "needs_review" || c.safetyStatus === "stop_use" || c.safetyStatus === "emergency"; }).length;
    var nHum = cases.filter(function (c) { return c.disposition === "human_requested"; }).length;
    [["New", nNew], ["Needs review", nRev], ["Human requested", nHum], ["Total", cases.length]].forEach(function (p) {
      box.appendChild(el("span", p[0] + ": " + p[1], "counter"));
    });
  }

  function loadInbox() {
    fetch("/api/v1/staff/cases").then(function (r) { return r.json(); }).then(function (j) {
      S.cases = j.cases || [];
      counters(S.cases);
      renderInbox();
      if (S.tab === "settings") loadSettings();
    });
  }

  function renderInbox() {
    var box = document.getElementById("inbox");
    clear(box);
    var q = (document.getElementById("search").value || "").toLowerCase();
    var statusF = document.getElementById("statusFilter").value;
    var list = S.cases.filter(function (c) {
      if (statusF !== "all" && c.workflowStatus !== statusF) return false;
      if (!q) return true;
      return ((c.reference || "") + " " + (c.appliance || "") + " " + (c.complaint || "") + " " + (c.zip || "")).toLowerCase().includes(q);
    });
    box.appendChild(el("h3", "Inbox (" + list.length + ")"));
    if (!list.length) box.appendChild(el("p", "No cases match.", "muted"));
    list.forEach(function (c) {
      var b = el("button", null, "inbox-row");
      var strong = el("b", c.reference + "  ");
      b.appendChild(strong);
      b.appendChild(document.createTextNode(
        (c.appliance || "?") + " — " + ((c.complaint || "").slice(0, 90)) +
        "  |  " + (c.zip || "?") + "  |  " + readable(c.safetyStatus) + "  |  " + readable(c.workflowStatus) +
        (c.disposition !== "pending" ? "  |  " + readable(c.disposition) : "")
      ));
      b.onclick = function () { openCase(c.id); };
      box.appendChild(b);
    });
  }

  function readable(value) { return String(value || "Unknown").replace(/_/g, " "); }
  function flag(text, danger) { return el("span", text, danger ? "flag flag-danger" : "flag"); }

  function openCase(id) {
    var paused = S.openId && S.openId !== id ? pauseActiveReview() : Promise.resolve();
    S.openId = id;
    history.replaceState(null, "", "#case=" + encodeURIComponent(id));
    return paused.then(function() { return fetch("/api/v1/staff/cases/" + id); }).then(function (r) { return r.json(); }).then(function (j) {
      if (S.openId !== id) return;
      S.detail = j;
      renderDetail(j);
    });
  }

  function renderDetail(j) {
    var d = document.getElementById("detail");
    clear(d);
    var c = j.case;
    var heading = el("h2", c.reference + " (v" + c.version + ")"); d.appendChild(heading);
    var flags = el("div", null, "flags");
    flags.appendChild(flag("safety: " + readable(c.safetyStatus), c.safetyStatus === "emergency" || c.safetyStatus === "stop_use"));
    flags.appendChild(flag("workflow: " + readable(c.workflowStatus), false));
    flags.appendChild(flag("disposition: " + readable(c.disposition), c.disposition === "human_requested"));
    flags.appendChild(flag("phase: " + readable(c.conversationPhase), false));
    d.appendChild(flags);

    var h = (j.handoffs || [])[(j.handoffs || []).length - 1];
    var snap = h ? h.snapshot : null;
    var staffReviews = (j.events || []).filter(function(e) { return e.type === "technician_review"; });
    var staffRevision = staffReviews[staffReviews.length - 1];
    if (staffRevision && staffRevision.payload.revisedBrief) {
      var revision = el("section", null, "card"); revision.appendChild(el("h3", staffRevision.payload.approved ? "Technician-approved brief" : "Technician revision — further review required"));
      revision.appendChild(el("p", staffRevision.payload.revisedBrief));
      revision.appendChild(el("p", "Recorded " + staffRevision.createdAt + ". Original submitted evidence is retained below.", "muted")); d.appendChild(revision);
    }
    var brief = el("div", null, "card");
    brief.appendChild(el("h3", "Technician brief" + (h ? " (handoff v" + h.version + ")" : " — not submitted yet")));
    if (!snap) {
      brief.appendChild(el("p", "The customer has not sent this request yet. Draft details from the transcript appear below.", "muted"));
    } else {
      var dl = document.createElement("dl");
      dl.className = "brief";
      function row(term, text, tag) {
        var dt = el("dt", term); dl.appendChild(dt);
        var dd = el("dd", text);
        if (tag) dd.appendChild(el("span", tag, "tag"));
        dl.appendChild(dd);
      }
      var ap = snap.appliance || {};
      row("Appliance", (ap.category || "?") + " / " + (ap.brand || "?") + " / " + (ap.model || "?") +
        (ap.model_confirmed ? " (identification confirmed)" : " (identification unconfirmed)"), "Reported by customer");
      row("Documentation", ({ exact_model: "Exact model", verified_family: "Verified family", category_only: "Category guidance only", category_family: "Legacy category/family (unverified)", unknown: "No applicable documentation" })[snap.knowledge_level] || "Unknown", null);
      row("Complaint", String(snap.complaint || "—"), "Reported by customer");
      row("Safety", "status " + ((snap.safety || {}).status || "?") + ", disposition " + ((snap.safety || {}).disposition || "?"), null);
      row("Contact", String((snap.contact || {}).name || "—") + " — " + String((snap.contact || {}).channel || "—") +
        "  |  ZIP " + String(snap.service_zip || "—") + "  |  window: " + String(snap.preferred_window || "—"), "Reported by customer");
      var facts = (snap.facts || []).filter(function (f) {
        return ["failure_stage", "drain_observation", "error_code", "display_reading", "cooling_scope", "sound_observation", "leak_observation", "load_observation"].includes(f.key);
      });
      row("Key observations", facts.length ? facts.map(function (f) { return ({ failure_stage: "When it happens", drain_observation: "Standing water", error_code: "Exact error text", display_reading: "Display", cooling_scope: "Affected compartments", sound_observation: "Sounds", leak_observation: "Leaks or ice", load_observation: "Load size" }[f.key] || f.key) + ": " + f.value; }).join("; ") : "—", "Reported by customer");
      var hyps = snap.hypotheses || [];
      row("Preliminary issue areas", hyps.length
        ? hyps.map(function (x) { return x.issueArea + " [" + x.priority + ", " + x.evidenceStrength + " support]"; }).join("  •  ")
        : (snap.assessment_status === "assessment_unavailable" ? "Model assessment unavailable — review facts directly." : "No hypothesis; technician diagnosis required."),
        hyps.length ? "AI hypothesis" : null);
      row("Missing information", ((snap.missing_information || []).join(", ") || "none") +
        (snap.incomplete_acknowledged ? " (customer sent as incomplete)" : ""), null);
      row("Recommended follow-up", String(snap.recommended_follow_up || "—"), "AI hypothesis");
      d.appendChild(brief);
      brief.appendChild(dl);
    }
    if (!snap) d.appendChild(brief);

    if (snap) {
      var panel = el("section", null, "card review-panel"); panel.appendChild(el("h3", "Technician decision"));
      var reviews = (j.events || []).filter(function(e) { return e.type === "technician_review"; });
      var latest = reviews[reviews.length - 1];
      panel.appendChild(el("p", latest ? (latest.payload.approved ? "Technician approved" : "Human follow-up required") : "AI draft — awaiting technician review", "flag"));
      var edits = document.createElement("details"); edits.appendChild(el("summary", "Corrections, missing facts and review time")); panel.appendChild(edits);
      function control(label, tag) { var l = el("label", label); var input = document.createElement(tag); l.appendChild(input); edits.appendChild(l); return input; }
      var revised = control("Edit brief (optional)", "textarea"); revised.rows = 5;
      revised.value = latest && latest.payload.revisedBrief || "";
      var missing = control("Missing facts (one per line)", "textarea");
      missing.value = latest ? latest.payload.missingFacts.join("\n") : "";
      var unsupported = control("Incorrect or unsupported assertions (one per line)", "textarea");
      unsupported.value = latest ? latest.payload.unsupportedAssertions.join("\n") : "";
      var seconds = control("Active review time in seconds (optional, manually recorded)", "input"); seconds.type = "number"; seconds.min = "0";
      var measured = control("Use the paused review timer instead of manual seconds", "input"); measured.type = "checkbox";
      var note = control("Feedback note", "textarea");
      note.value = latest && latest.payload.note || "";
      var status = el("p", ""); status.setAttribute("role", "status");
      [["ready_to_contact", "Ready to contact / plan visit"], ["need_information", "Need more information"], ["urgent_review", "Needs urgent human review"]].forEach(function(pair) {
        var b = el("button", pair[1], "btn"); b.disabled = S.user && S.user.role === "readonly";
        b.onclick = function() {
          b.disabled = true;
          function lines(value) { return value.split("\n").map(function(s) { return s.trim(); }).filter(Boolean); }
          fetch("/api/v1/staff/cases/" + c.id + "/review", { method: "POST", headers: csrf(), body: JSON.stringify({
            version: c.version, disposition: pair[0], revisedBrief: revised.value || undefined,
            missingFacts: lines(missing.value), unsupportedAssertions: lines(unsupported.value),
            reviewSeconds: seconds.value === "" ? null : Number(seconds.value), timingMethod: measured.checked ? "measured" : seconds.value === "" ? "not_recorded" : "manual", note: note.value
          }) }).then(function(r) { if (!r.ok) throw new Error("Save failed; refresh and retry."); openCase(c.id); }).catch(function(e) { status.textContent = e.message; b.disabled = false; });
        }; panel.appendChild(b);
      }); panel.appendChild(status); d.appendChild(panel);
    }
    // Photos.
    var photos = el("div", null, "card");
    photos.appendChild(el("h3", "Photos (" + (j.attachments || []).length + ")"));
    if (!(j.attachments || []).length) photos.appendChild(el("p", "No photos.", "muted"));
    (j.attachments || []).forEach(function (a) {
      var wrap = el("div", null);
      var img = document.createElement("img");
      img.className = "thumb";
      img.alt = a.kind + " photo";
      img.src = "/api/v1/staff/cases/" + c.id + "/attachments/" + a.id;
      var link = document.createElement("a"); link.href = img.src; link.target = "_blank"; link.rel = "noopener"; link.appendChild(img); wrap.appendChild(link);
      wrap.appendChild(el("div", a.kind + " — " + a.mimeType, "muted"));
      photos.appendChild(wrap);
    });
    d.appendChild(photos);

    var effort = el("section", null, "card identity-panel");
    effort.appendChild(el("h3", "Identity verification and active review time"));
    var verification = (j.events || []).filter(function(e) { return e.type === "technician_identity_verified"; }).slice(-1)[0];
    var verifiedStatus = el("p", verification
      ? "Technician verified: " + verification.payload.brand + " " + verification.payload.model + " · " + verification.createdAt
      : "Identity has not been verified by a technician.");
    effort.appendChild(verifiedStatus);
    var brand = el("input"), model = el("input"), serial = el("input"), basis = el("select"), basisNote = el("input");
    [[brand, "Verified brand", 100], [model, "Verified model", 120],
      [serial, "Verified serial (optional)", 120], [basisNote, "How you verified this identity", 1000]].forEach(function(pair) {
      pair[0].type = "text"; pair[0].maxLength = pair[2];
      var label = el("label", pair[1]); label.appendChild(pair[0]); effort.appendChild(label);
    });
    ["physical_label", "customer_contact", "reviewed_document"].forEach(function(v) {
      var o = el("option", v.replace(/_/g, " ")); o.value = v; basis.appendChild(o);
    });
    var basisLabel = el("label", "Verification source"); basisLabel.appendChild(basis); effort.appendChild(basisLabel);
    if (verification) {
      brand.value = verification.payload.brand; model.value = verification.payload.model;
      serial.value = verification.payload.serial || ""; basis.value = verification.payload.provenance;
      basisNote.value = verification.payload.note;
    }
    var canEdit = !(S.user && S.user.role === "readonly");
    var verify = el("button", "Record technician verification", "btn secondary");
    var verificationStatus = el("p", ""); verificationStatus.setAttribute("role", "status");
    verify.disabled = !canEdit;
    verify.onclick = function() {
      verify.disabled = true;
      fetch("/api/v1/staff/cases/" + c.id + "/identity-verification", {
        method: "POST", headers: csrf(), body: JSON.stringify({version: c.version, brand: brand.value.trim(),
          model: model.value.trim(), serial: serial.value.trim() || null, provenance: basis.value, note: basisNote.value.trim()})
      }).then(function(r) {
        if (!r.ok) throw Error("Verification failed; check fields and refresh.");
        return r.json();
      }).then(function(x) {
        c.version = x.version; heading.textContent = c.reference + " (v" + c.version + ")";
        verifiedStatus.textContent = "Technician verified: " + x.verification.payload.brand + " " + x.verification.payload.model + " · " + x.verification.createdAt;
        verificationStatus.textContent = "Verification saved.";
      }).catch(function(e) { verificationStatus.textContent = e.message; }).finally(function() { verify.disabled = !canEdit; });
    };
    effort.appendChild(verify);
    effort.appendChild(verificationStatus);
    var timerStatus = el("p", ""); timerStatus.setAttribute("role", "status"); effort.appendChild(timerStatus);
    var toggle = el("button", "", "btn secondary");
    j.refreshTimer = function() {
      var timer = j.reviewTimer || {activeSeconds: 0, startedAt: null};
      timerStatus.textContent = j.timerError || ("Recorded active review: " + timer.activeSeconds + " seconds" +
        (timer.startedAt ? " · timer running" : " · paused") + ". Manual durations are recorded separately.");
      toggle.textContent = timer.startedAt ? "Pause active review" : "Resume active review";
      toggle.disabled = !canEdit || !!j.timerRequest;
      heading.textContent = c.reference + " (v" + c.version + ")";
    };
    j.refreshTimer();
    toggle.onclick = function() { changeReviewTimer(j, j.reviewTimer && j.reviewTimer.startedAt ? "pause" : "start"); };
    effort.appendChild(toggle); d.appendChild(effort);

    // Sources.
    if (snap && snap.citations && snap.citations.length) {
      var src = el("div", null, "card");
      src.appendChild(el("h3", "Cited sources (" + snap.citations.length + ")"));
      snap.citations.forEach(function (ct) {
        src.appendChild(el("p", (ct.title || ct.documentId) + " · " + (ct.documentVersion || "legacy version unavailable") + " · PDF page " + (ct.pdfPageIndex == null ? "unknown" : ct.pdfPageIndex + 1) + " · printed " + (ct.printedPageLabel || ct.page || "unknown") + " · " + (ct.applicabilityBasis || "legacy applicability unavailable")));
        var excerpt = document.createElement("details"); excerpt.appendChild(el("summary", "Open source excerpt"));
        excerpt.appendChild(el("blockquote", ct.excerpt || ct.quote || "Unavailable"));
        excerpt.appendChild(el("p", "Document hash: " + (ct.documentHash || "unavailable"), "muted"));
        src.appendChild(excerpt);
      });
      d.appendChild(src);
    }

    // Transcript + audit.
    var tr = document.createElement("details");
    tr.appendChild(el("summary", "Transcript (" + (j.messages || []).length + " messages)"));
    (j.messages || []).forEach(function (m) {
      var p = el("p", null);
      p.appendChild(el("b", m.role + ": "));
      p.appendChild(document.createTextNode(m.body));
      tr.appendChild(p);
    });
    d.appendChild(tr);
    var au = document.createElement("details");
    au.appendChild(el("summary", "Audit history (" + (j.events || []).length + " events)"));
    (j.events || []).forEach(function (e) {
      au.appendChild(el("p", e.createdAt + " — " + e.type + " " + JSON.stringify(e.payload).slice(0, 200), "muted"));
    });
    d.appendChild(au);

    // Facts with provenance.
    var fr = document.createElement("details");
    fr.appendChild(el("summary", "Facts with provenance (" + (j.facts || []).length + ")"));
    (j.facts || []).forEach(function (f) {
      fr.appendChild(el("p", f.key + " = " + String(f.value) + " [" + f.status + "/" + f.certainty +
        (f.sourceAttachmentId ? ", Extracted from photo" : f.sourceMessageId ? ", Reported by customer" : "") + "]", "muted"));
    });
    d.appendChild(fr);

    // Outcome.
    var oc = el("div", null, "card");
    oc.appendChild(el("h3", "Repair outcome"));
    if (j.outcome) oc.appendChild(el("p", "Recorded: " + j.outcome.rating + (j.outcome.confirmedIssue ? " — " + j.outcome.confirmedIssue : "")));
    var sel = document.createElement("select"); sel.id = "rating";
    [["useful_as_received", "Useful as received"], ["useful_after_corrections", "Useful after minor corrections"],
     ["needed_followup", "Needed substantial follow-up"], ["misleading_or_unusable", "Misleading or unusable"]
    ].forEach(function (o) { var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op); });
    oc.appendChild(sel);
    var issue = document.createElement("input");
    issue.type = "text"; issue.id = "issue"; issue.placeholder = "Confirmed issue (Technician confirmed)";
    oc.appendChild(issue);
    var sb = el("button", "Save outcome", "btn");
    sb.onclick = function () {
      fetch("/api/v1/staff/cases/" + c.id + "/outcome", {
        method: "POST", headers: csrf(),
        body: JSON.stringify({ rating: document.getElementById("rating").value, confirmedIssue: document.getElementById("issue").value }),
      }).then(function (r) { return r.json().then(function (x) { return { r: r, x: x }; }); })
        .then(function (o) {
          alert(o.r.ok ? "Outcome saved." : ((o.x.error && o.x.error.message) || "Outcome save failed."));
          if (o.r.ok) openCase(c.id);
        });
    };
    oc.appendChild(sb);
    d.appendChild(oc);

    // Status / assignment.
    var st = el("div", null, "card");
    st.appendChild(el("h3", "Assignment and status"));
    ["workflowStatus:reviewing,contacted,scheduled,closed,cancelled", "safetyStatus:needs_review,stop_use,emergency,no_hazard_reported"].forEach(function (spec) {
      var parts = spec.split(":");
      st.appendChild(el("label", parts[0]));
      var s2 = document.createElement("select"); s2.id = "f_" + parts[0];
      parts[1].split(",").forEach(function (o) { var op = document.createElement("option"); op.textContent = o; s2.appendChild(op); });
      st.appendChild(s2);
    });
    st.appendChild(el("label", "Assignee / note"));
    var note = document.createElement("input");
    note.type = "text"; note.id = "note"; note.placeholder = "assignee or internal note";
    st.appendChild(note);
    var ub = el("button", "Update case", "btn");
    ub.onclick = function () {
      fetch("/api/v1/staff/cases/" + c.id, {
        method: "PATCH", headers: csrf(),
        body: JSON.stringify({
          workflowStatus: document.getElementById("f_workflowStatus").value,
          safetyStatus: document.getElementById("f_safetyStatus").value,
          note: document.getElementById("note").value, version: c.version,
        }),
      }).then(function (r) { return r.json(); }).then(function (x) {
        alert(x.ok ? "Updated." : ((x.error && x.error.message) || "Update failed."));
        loadInbox();
        if (location.hash.startsWith("#case=")) openCase(decodeURIComponent(location.hash.slice(6))); openCase(c.id);
      });
    };
    st.appendChild(ub);
    var exp = el("button", "Export handoff JSON", "btn");
    exp.onclick = function () {
      var blob = new Blob([JSON.stringify({ case: c, handoffs: j.handoffs, assessment: j.assessment }, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = c.reference + ".json";
      a.click();
    };
    st.appendChild(exp);
    var pr = el("button", "Print", "btn");
    pr.onclick = function () { window.print(); };
    st.appendChild(pr);
    d.appendChild(st);

    // Full JSON (secondary tool, no truncation).
    var full = document.createElement("details");
    full.appendChild(el("summary", "Full handoff JSON"));
    var pre = el("pre", h ? JSON.stringify(h.snapshot, null, 2) : "(not submitted yet)", "dump");
    full.appendChild(pre);
    d.appendChild(full);
  }

  function loadSettings() {
    fetch("/api/v1/staff/settings").then(function (r) { return r.json(); }).then(function (s) {
      var box = document.getElementById("settings");
      clear(box);
      var t = s.tenant || {};
      box.appendChild(el("h3", "Organization settings (operator-managed for the pilot)"));
      var dl = document.createElement("dl");
      dl.className = "brief";
      [["Business", (t.name || "") + " [" + (t.orgType || "") + "]"],
       ["Branding", "primary " + ((t.branding || {}).primaryColor || "?")],
       ["Timezone / languages", (t.timezone || "") + " / " + ((t.languages || []).join(","))],
       ["Service area", t.serviceZips ? t.serviceZips.join(", ") : "unrestricted intake"],
       ["Appliances", (t.categories || []).join(", ")],
       ["Detailed playbooks", (t.detailedCategories || []).join(", ")],
       ["Required fields", (t.requiredFields || []).join(", ")],
       ["Routing", (t.routing || {}).queue + " → " + (t.routing || {}).destination],
       ["Gas utility contact", t.gasUtilityContact || ""],
       ["Privacy", t.privacyText || ""]
      ].forEach(function (p) {
        dl.appendChild(el("dt", p[0]));
        dl.appendChild(el("dd", p[1]));
      });
      box.appendChild(dl);
      box.appendChild(el("h3", "Website origins and embed snippet"));
      box.appendChild(el("p", "Allowed origins: " + ((t.allowedOrigins || []).join(", ") || "(platform hosted origin only)"), "muted"));
      var code = el("code",
        '<script src="' + location.origin + '/widget/v1.js"\n' +
        '  data-public-key="' + (t.publicKey || "") + '"\n  data-mode="launcher"\n  defer>\n</script>', "snippet");
      box.appendChild(code);
      box.appendChild(el("h3", "Service credentials"));
      var creds = s.serviceCredentials || [];
      box.appendChild(el("p", creds.length ? creds.map(function (c) { return c.name + " [" + c.scopes.join(", ") + "]"; }).join("; ") : "None.", "muted"));
      box.appendChild(el("h3", "Background delivery and processing"));
      fetch("/api/v1/staff/jobs").then(function(r){return r.json();}).then(function(data){
        (data.jobs||[]).slice(0,30).forEach(function(job){
          var row=el("p",job.kind+" · "+job.status+" · attempt "+job.attempts+"/"+job.maxAttempts+(job.availableAt?" · due "+job.availableAt:""));
          if(job.status==="failed"&&(job.operatorRetries||0)<3){var retry=el("button","Retry","btn secondary");retry.onclick=function(){fetch("/api/v1/staff/jobs/"+job.id+"/retry",{method:"POST",headers:csrf(),body:"{}"}).then(function(r){if(!r.ok)alert("Retry denied or limit reached.");loadSettings();});};row.appendChild(retry);}box.appendChild(row);
        });
      });
      box.appendChild(el("h3", "Webhooks"));
      var eps = (s.webhooks || {}).endpoints || [];
      box.appendChild(el("p", eps.length ? eps.map(function (e) { return e.url + " [" + e.events.join(", ") + "]" + (e.active ? "" : " (inactive)"); }).join("; ") : "No endpoints configured.", "muted"));
      var dels = ((s.webhooks || {}).deliveries || []).slice(0, 10);
      if (dels.length) {
        var tbl = document.createElement("table");
        tbl.className = "plain";
        var hr = document.createElement("tr");
        ["Event", "Type", "Status", "Attempts"].forEach(function (h) { var th = document.createElement("th"); th.textContent = h; hr.appendChild(th); });
        tbl.appendChild(hr);
        dels.forEach(function (x) {
          var tr = document.createElement("tr");
          [x.eventId.slice(0, 8), x.eventType, x.status, String(x.attempts)].forEach(function (v) { var td = document.createElement("td"); td.textContent = v; tr.appendChild(td); });
          tbl.appendChild(tr);
        });
        box.appendChild(tbl);
      }
      box.appendChild(el("h3", "Knowledge coverage"));
      var docs = ((s.knowledge || {}).documents || []);
      box.appendChild(el("p", docs.length + " documents, " + (s.knowledge.chunkCount || 0) + " chunks. Model-specific guidance depends on available documentation.", "muted"));
      docs.forEach(function (x) {
        box.appendChild(el("p", x.title + " [" + x.visibility + "/" + x.reviewStatus + "]", "muted"));
      });
    });
  }

  document.getElementById("go").onclick = login;
  document.getElementById("refresh").onclick = loadInbox;
  document.getElementById("search").addEventListener("input", renderInbox);
  document.getElementById("statusFilter").addEventListener("change", renderInbox);
  document.getElementById("tabInbox").onclick = function () {
    S.tab = "inbox";
    document.getElementById("inboxPane").style.display = "";
    document.getElementById("settings").style.display = "none";
  };
  document.getElementById("tabSettings").onclick = function () {
    pauseActiveReview();
    S.tab = "settings";
    document.getElementById("inboxPane").style.display = "none";
    document.getElementById("settings").style.display = "block";
    loadSettings();
  };
})();
