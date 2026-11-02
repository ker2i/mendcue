/* Public, browser-only product walkthrough. No network/model calls or storage. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const scenarios = {
    washer: {
      appliance: 'Washing machine', title: 'Washer drainage complaint', icon: 'washer',
      complaint: 'My washer stopped halfway through the cycle. There’s still water in the drum.',
      questions: [
        { text: 'Is water still standing in the drum, or has it drained?', label: 'Drainage', options: ['Water is still standing', 'It has drained', 'I’m not sure'] },
        { text: 'When did you first notice this happening?', label: 'Timeline', options: ['Today', 'A few days ago', 'I’m not sure'] },
        { text: 'Is any error text visible? Copy it exactly; we won’t assume what the code means.', label: 'Display / exact error text', options: ['OE', 'No error text visible', 'I can’t safely check'] },
      ],
      excerpt: 'Record the cycle stage, whether water remains in the drum, and any display text verbatim. Do not interpret a code for a specific model without applicable documentation. Only ask for observations that can be made safely.',
      missing: ['Exact appliance identity', 'Customer contact details', 'Availability preference'],
    },
    fridge: {
      appliance: 'Refrigerator', title: 'Refrigerator cooling complaint', icon: 'fridge',
      complaint: 'My refrigerator feels warmer than usual. I’m not sure what’s going on.',
      questions: [
        { text: 'Which compartment seems affected: the refrigerator, freezer, or both?', label: 'Affected compartments', options: ['Refrigerator only', 'Both compartments', 'I’m not sure'] },
        { text: 'How long have you noticed the temperature change?', label: 'Timeline', options: ['Since today', 'A few days', 'I’m not sure'] },
        { text: 'Without changing any controls, can you read a temperature or error from the display?', label: 'Display observation', options: ['Display reads 48°F', 'No display reading', 'I can’t safely check'] },
      ],
      excerpt: 'Establish which compartments are affected, the reported timeline, and any visible display readings. Keep observations separate from a diagnosis. Do not ask the customer to move the appliance or remove panels.',
      missing: ['Exact appliance identity', 'Customer contact details', 'Actual compartment temperatures if unknown'],
    },
    safety: {
      appliance: 'Dryer', title: 'Possible gas leak — urgent review', icon: 'shield',
      complaint: 'I can smell gas near my dryer.', questions: [],
      excerpt: 'A reported gas smell interrupts normal intake. Leave the area and avoid flames and electrical switches. Contact emergency services and the gas utility from a safe location. Service intake is not an emergency response channel.',
      missing: ['Safety confirmation from a person', 'Appliance identity when safe', 'Direct human follow-up'],
    },
  };
  let state;
  let photoUrl = null;
  const sourceDialog = $('source-dialog');

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + name); svg.append(use); return svg;
  }
  function button(text, className, action) {
    const node = el('button', text, className); node.type = 'button';
    node.addEventListener('click', action); return node;
  }
  function message(role, text) {
    const wrapper = el('div', null, 'message ' + role);
    wrapper.append(el('span', role === 'customer' ? 'Y' : 'm.', 'message-avatar'));
    const body = el('div', null, 'message-body');
    body.append(el('span', role === 'customer' ? 'Sample customer' : 'MendCue · scripted demo', 'message-name'), document.createTextNode(text));
    wrapper.append(body); return wrapper;
  }
  function reset(key = state?.scenario || 'washer') {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = null;
    state = { scenario: key, answers: [], notes: [], submitted: false, disposition: null, urgent: key === 'safety', identity: { brand: '', model: '', serial: '', confirmed: false }, photo: false };
    $('identity-form').reset(); $('note-form').reset();
    $('label-preview').hidden = true; $('label-preview').removeAttribute('src');
    document.querySelectorAll('[data-scenario]').forEach(node => {
      const active = node.dataset.scenario === key;
      node.classList.toggle('active', active); node.setAttribute('aria-pressed', String(active));
    });
    selectTab('customer'); renderConversation(); renderBrief();
  }
  function selectTab(name, focus = false) {
    ['customer', 'technician'].forEach(view => {
      const active = name === view;
      $('tab-' + view).setAttribute('aria-selected', String(active));
      $('tab-' + view).tabIndex = active ? 0 : -1;
      $(view + '-panel').hidden = !active;
    });
    if (name === 'technician') renderBrief();
    if (focus) $('tab-' + name).focus();
  }
  function renderConversation(focus = false) {
    const scenario = scenarios[state.scenario];
    const log = $('conversation');
    log.replaceChildren(
      message('assistant', 'Let’s get the useful details together. This is a scripted demo: choose an answer below, or add a note for the brief.'),
      message('customer', scenario.complaint)
    );
    scenario.questions.forEach((question, index) => {
      if (index <= state.answers.length && !state.urgent) log.append(message('assistant', question.text));
      if (state.answers[index] !== undefined) log.append(message('customer', state.answers[index]));
    });
    state.notes.forEach(note => log.append(message('customer', note)));
    const complete = state.urgent || state.answers.length === scenario.questions.length;
    if (complete) log.append(message('assistant', state.urgent
      ? 'Safety comes first. Normal questions are paused. This demo does not contact emergency services. You can review a demonstration brief below; only enter label details if you already know them.'
      : 'That gives the technician a clearer starting point. Add the label details you know, review them, and create your demo brief.'));
    const choices = $('reply-choices'); choices.replaceChildren();
    if (!complete && !state.submitted) {
      scenario.questions[state.answers.length].options.forEach(option => {
        choices.append(button(option, '', () => {
          state.answers.push(option); state.disposition = null;
          renderConversation(true); renderBrief();
        }));
      });
    }
    $('safety-notice').hidden = !state.urgent;
    $('review-form-wrap').hidden = !complete || state.submitted;
    $('sent-message').hidden = !state.submitted;
    $('note-form').hidden = state.submitted;
    if (focus) {
      const target = choices.querySelector('button') || $('identity-brand');
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
  function row(list, label, value, full = false, provenance = null) {
    const item = el('div', null, full ? 'full' : '');
    const dd = el('dd');
    if (Array.isArray(value)) {
      const ul = el('ul'); value.forEach(v => ul.append(el('li', v))); dd.append(ul);
    } else dd.textContent = value;
    if (provenance) dd.append(el('span', provenance, 'provenance-tag'));
    item.append(el('dt', label), dd); list.append(item);
  }
  function readIdentity() {
    state.identity = { brand: $('identity-brand').value.trim(), model: $('identity-model').value.trim(), serial: $('identity-serial').value.trim(), confirmed: $('identity-confirmed').checked };
  }
  function briefData() {
    const scenario = scenarios[state.scenario];
    return {
      demo: true, syntheticScenario: state.scenario, reference: 'DEMO-1042',
      disclaimer: 'Browser-only synthetic demonstration. No live inference, real service request, or manufacturer documentation.',
      appliance: scenario.appliance, identity: { ...state.identity },
      complaint: scenario.complaint,
      observations: scenario.questions.map((q, i) => ({ label: q.label, value: state.answers[i] ?? null, source: state.answers[i] === undefined ? 'not_collected' : 'scripted_customer_reply' })),
      notes: [...state.notes], safety: state.urgent ? 'urgent_human_review' : 'no_hazard_reported_in_scenario',
      documentationCoverage: 'generic_example_only',
      missing: scenario.missing.filter(f => f !== 'Exact appliance identity' || !state.identity.confirmed || !state.identity.model || !state.identity.brand),
      submittedLocally: state.submitted, demonstrationDisposition: state.disposition,
      photo: state.photo ? 'Local preview only; photo bytes excluded from export' : null,
    };
  }
  function renderBrief() {
    const data = briefData(), scenario = scenarios[state.scenario];
    const content = $('brief-content'); content.replaceChildren();
    const heading = el('div', null, 'brief-header'); const title = el('div');
    title.append(el('h3', 'The service brief.'), el('p', 'DEMO-1042 · Synthetic scenario · ' + (state.submitted ? 'Created in this tab' : 'Draft preview')));
    const badge = el('span', state.urgent ? 'Urgent human review' : state.disposition === 'ready' ? 'Approved in demo' : state.submitted ? 'Ready for review' : 'Draft · not submitted', 'brief-badge' + (state.urgent ? ' urgent' : state.disposition === 'ready' ? ' approved' : ''));
    heading.append(title, badge); content.append(heading);
    const identity = el('div', null, 'brief-identity'); const detail = el('div');
    detail.append(el('strong', scenario.appliance + ' / ' + (data.identity.brand || 'Brand unknown') + ' / ' + (data.identity.model || 'Model unknown')));
    detail.append(el('p', data.identity.confirmed && data.identity.model && data.identity.brand ? 'Transcription checked in this demo · not technician verified' : 'Identity unconfirmed · category guidance only'));
    identity.append(icon(scenario.icon), detail); content.append(identity);
    const list = el('dl', null, 'brief-data');
    row(list, 'Customer’s complaint', data.complaint, true, 'Synthetic customer report');
    data.observations.forEach(f => row(list, f.label, f.value ?? 'Not collected', false, f.value ? 'Scripted reply' : 'Unknown'));
    row(list, 'Safety', state.urgent ? 'Possible gas leak. Normal questioning paused. Immediate safety instructions shown; human review required.' : 'No hazard reported in this synthetic scenario. This is not a safety clearance.', true);
    if (data.notes.length) row(list, 'Additional notes', data.notes, true, 'Visitor-entered');
    if (data.identity.serial) row(list, 'Serial number', data.identity.serial);
    row(list, 'Documentation', 'Generic example guidance only. No model-specific manufacturer manual is supplied.', true);
    row(list, 'Preliminary issue area', state.urgent ? 'Safety report — no troubleshooting or cause assessment.' : scenario.title + '. Cause requires technician diagnosis.', true, 'Unconfirmed issue area');
    row(list, 'Still to establish', data.missing.length ? data.missing : ['Technician verification and next steps'], true);
    content.append(list);
    const source = button('', 'brief-source', () => {
      $('source-excerpt').textContent = scenario.excerpt;
      $('source-applicability').textContent = scenario.appliance + ' category only. No exact model applicability established.';
      sourceDialog.showModal();
    });
    source.append(icon('document'), el('span', 'See the example guidance & its limits'), icon('arrow')); content.append(source);
    const actions = el('div', null, 'brief-actions');
    const approve = button(state.urgent ? 'Mark for urgent human review' : 'Approve demo brief', 'button button-dark', () => {
      state.disposition = state.urgent ? 'urgent' : 'ready'; renderBrief();
      $('disposition-status').focus({ preventScroll: true });
    });
    approve.disabled = !state.submitted || Boolean(state.disposition);
    const edit = button('Edit intake', 'button button-outline', () => { state.submitted = false; state.disposition = null; selectTab('customer'); renderConversation(); });
    const download = button('Download brief', 'button button-outline', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(briefData(), null, 2)], { type: 'application/json' }));
      const link = el('a'); link.href = url; link.download = 'mendcue-demo-brief.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    download.prepend(icon('download')); actions.append(approve, edit, download); content.append(actions);
    const status = el('p', state.disposition ? (state.urgent ? 'Marked urgent in this local walkthrough. No emergency or repair service has been contacted.' : 'Approved in this walkthrough. This is a demonstration action, not a real technician assessment.') : !state.submitted ? 'Complete the customer intake to enable the demonstration approval.' : 'A person can review, correct, and decide what happens next.', 'action-status');
    status.id = 'disposition-status'; status.setAttribute('role', 'status'); status.tabIndex = -1; content.append(status);
    const details = el('details', null, 'brief-disclosure');
    details.append(el('summary', 'What this preview does—and doesn’t—show'), el('p', 'Your choices and notes are assembled by browser code. There is no diagnosis, background AI request, appointment booking, or server-side storage. The full application’s Meta integration and real pilot results remain unverified.'));
    content.append(details);
  }

  document.querySelectorAll('[data-scenario]').forEach(node => node.addEventListener('click', () => reset(node.dataset.scenario)));
  $('reset-demo').addEventListener('click', () => reset());
  ['customer', 'technician'].forEach(name => {
    $('tab-' + name).addEventListener('click', () => selectTab(name));
    $('tab-' + name).addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); selectTab(event.key === 'Home' ? 'customer' : event.key === 'End' ? 'technician' : name === 'customer' ? 'technician' : 'customer', true);
    });
  });
  $('open-brief').addEventListener('click', () => selectTab('technician', true));
  $('note-form').addEventListener('submit', event => {
    event.preventDefault(); const input = $('customer-note'); const text = input.value.trim(); if (!text) return;
    state.notes.push(text); input.value = ''; state.disposition = null;
    if (/\b(gas (?:smell|leak)|smell (?:of )?gas)\b/i.test(text)) state.urgent = true;
    renderConversation(); renderBrief();
  });
  $('identity-form').addEventListener('submit', event => {
    event.preventDefault(); readIdentity();
    if (state.identity.confirmed && (!state.identity.brand || !state.identity.model)) {
      $('identity-model').setCustomValidity('Add the brand and model, or leave the confirmation unchecked to continue with unknown identity.');
      $('identity-model').reportValidity(); return;
    }
    $('identity-model').setCustomValidity(''); state.submitted = true; state.disposition = null;
    renderConversation(); selectTab('technician'); $('tab-technician').focus({ preventScroll: true });
  });
  $('identity-form').addEventListener('input', event => {
    $('identity-model').setCustomValidity('');
    if (['identity-brand', 'identity-model'].includes(event.target.id)) $('identity-confirmed').checked = false;
    readIdentity(); state.disposition = null;
  });
  $('label-photo').addEventListener('change', event => {
    const file = event.target.files[0]; if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      event.target.setCustomValidity('Choose a JPEG, PNG, or WebP image up to 5 MB.'); event.target.reportValidity(); event.target.value = ''; return;
    }
    event.target.setCustomValidity('');
    if (photoUrl) URL.revokeObjectURL(photoUrl); photoUrl = URL.createObjectURL(file);
    $('label-preview').src = photoUrl; $('label-preview').hidden = false; state.photo = true;
  });
  $('close-source').addEventListener('click', () => sourceDialog.close());
  sourceDialog.addEventListener('click', event => { if (event.target === sourceDialog) { const rect = sourceDialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) sourceDialog.close(); } });
  reset();
})();
