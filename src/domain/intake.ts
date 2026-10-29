// Shared tenant-aware intake engine. Used by widget, hosted site, dashboard, API.
import { randomUUID } from "node:crypto";
import type { Assessment, CaseFact, CaseRecord, Message, TenantConfig } from "./types.js";
import { detectConflicts, isAllowedKey, isUnknownValue, normalizeFact } from "./facts.js";
import { containsForbiddenAction, gasLeakScript, generalHazardScript, screenHazards } from "./safety.js";
import { findAction, findQuestion, nextQuestion } from "./questions.js";
import { normalizeModel, retrieveKnowledge, validateCitations } from "./knowledge.js";
import type { ModelProvider } from "../integrations/meta/provider.js";
import { ModelFailure } from "../integrations/meta/provider.js";
import type { Store } from "../db/store.js";

export interface EngineDeps {
  store: Store;
  provider: ModelProvider;
  storageGet: (key: string) => Promise<Buffer | null>;
}

export interface TurnOutcome {
  reply: string;
  phase: string;
  safetyStatus: string;
  factsAdded: string[];
  conflicts: Array<{ key: string; existing: unknown; proposed: unknown }>;
  questionId: string | null;
  actionId: string | null;
  modelMode: string;
}

function ref(): string {
  return `AI-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export function newCaseId(): string { return randomUUID(); }

export async function createCase(
  deps: EngineDeps, tenant: TenantConfig, source: CaseRecord["source"],
  externalReference: string | null = null
): Promise<CaseRecord> {
  const now = new Date().toISOString();
  const c: CaseRecord = {
    id: newCaseId(), tenantId: tenant.id, reference: ref(), source,
    conversationPhase: "consent", workflowStatus: "draft",
    safetyStatus: "unchecked", disposition: "pending",
    version: 1, externalReference, diagnosticQuestionsAsked: 0,
    modelMode: deps.provider.mode === "live" ? "live" : "fixture",
    createdAt: now, updatedAt: now, submittedAt: null,
  };
  await deps.store.createCase(c);
  await deps.store.addEvent({
    id: randomUUID(), tenantId: tenant.id, caseId: c.id,
    type: "case_created", payload: { source, externalReference }, createdAt: now,
  });
  return c;
}

async function askedIds(store: Store, tenantId: string, caseId: string): Promise<Set<string>> {
  const events = await store.listEvents(tenantId, caseId);
  return new Set(events.filter((e) => e.type === "question_asked").map((e) => String(e.payload.questionId)));
}

function latestFacts(facts: CaseFact[]): Map<string, CaseFact> {
  const m = new Map<string, CaseFact>();
  for (const f of facts) {
    if (f.status === "superseded") continue;
    m.set(f.key, f);
  }
  return m;
}

function summarizeForReview(tenant: TenantConfig, facts: Map<string, CaseFact>): string {
  const get = (k: string) => {
    const f = facts.get(k);
    if (!f || f.value === null) return "— (missing)";
    return String(f.value);
  };
  return (
    `Here's what I have for ${tenant.name}. Reply with corrections, or say "submit" to send this to the service team:\n` +
    `• Appliance: ${get("appliance_category")}\n` +
    `• Problem: ${get("problem_description")}\n` +
    `• ZIP: ${get("service_zip")}\n` +
    `• Brand: ${get("brand")}\n` +
    `• Model: ${get("model_number")}\n` +
    `• Error/display: ${get("error_code")}${facts.get("display_reading") ? ` / ${facts.get("display_reading")!.value}` : ""}\n` +
    `• Contact: ${get("contact_name")} — ${get("contact_channel")}\n` +
    `• Preferred window: ${get("preferred_window")}`
  );
}

// Deterministic fallback extraction when the model is unavailable.
function fallbackExtract(text: string, messageId: string): Array<{ key: string; value: string | number | boolean | null }> {
  const out: Array<{ key: string; value: string | number | boolean | null }> = [];
  const zip = text.match(/\b\d{5}(?:-\d{4})?\b/);
  if (zip) out.push({ key: "service_zip", value: zip[0] });
  const lower = text.toLowerCase();
  if (/\b(fridge|refrigerator)\b/.test(lower)) out.push({ key: "appliance_category", value: "refrigerator" });
  else if (/\bwasher|washing\b/.test(lower)) out.push({ key: "appliance_category", value: "washer" });
  else if (/\bdishwash/.test(lower)) out.push({ key: "appliance_category", value: "dishwasher" });
  void messageId;
  return out;
}

export async function processTurn(
  deps: EngineDeps, tenant: TenantConfig, caseId: string, messageId: string, text: string
): Promise<TurnOutcome> {
  const store = deps.store;
  const c = await store.getCase(tenant.id, caseId);
  if (!c) throw new Error("case not found");
  if (c.conversationPhase === "submitted" || c.conversationPhase === "closed") {
    throw new Error("case already submitted");
  }
  const now = new Date().toISOString();
  const facts = await store.listFacts(tenant.id, caseId);
  const current = latestFacts(facts);
  const asked = await askedIds(store, tenant.id, caseId);

  // 1. Immediate deterministic hazard check — before any model call.
  const hits = screenHazards(text);
  if (hits.length > 0) {
    const gas = hits.find((h) => h.type === "gas_leak");
    const reply = gas ? gasLeakScript(tenant.gasUtilityContact) : generalHazardScript(hits[0].type);
    c.safetyStatus = gas ? "emergency" : "stop_use";
    c.version += 1;
    c.updatedAt = now;
    await store.updateCase(c);
    await persistAssistant(store, tenant.id, c, reply);
    await store.addEvent({
      id: randomUUID(), tenantId: tenant.id, caseId: c.id, type: "hazard_flagged",
      payload: { hits }, createdAt: now,
    });
    return { reply, phase: c.conversationPhase, safetyStatus: c.safetyStatus, factsAdded: [], conflicts: [], questionId: null, actionId: null, modelMode: c.modelMode };
  }
  if (c.safetyStatus === "unchecked") {
    c.safetyStatus = "no_hazard_reported";
  }

  // 2. Model extraction with graceful fallback.
  let modelMode: string = deps.provider.mode;
  let proposed: Array<{ key: string; value: string | number | boolean | null; certainty: "explicit" | "inferred" | "uncertain" }> = [];
  let handoffRequested = /\b(submit|that's all|talk to (a )?person|human|done|finish)\b/i.test(text);
  let suggestedQuestionId: string | null = null;
  let suggestedActionId: string | null = null;
  try {
    const allowedQ = (await import("./questions.js")).QUESTIONS.map((q) => q.id);
    const allowedA = (await import("./questions.js")).CUSTOMER_ACTIONS
      .filter((a) => a.reviewStatus === "approved").map((a) => a.action_id);
    const result = await deps.provider.extractIntakeTurn({
      tenantId: tenant.id, caseId: c.id, messageId, messageText: text,
      knownFacts: [...current.entries()].map(([key, f]) => ({ key, value: f.value })),
      askedQuestionIds: [...asked], allowedQuestionIds: allowedQ, allowedActionIds: allowedA,
      category: current.get("appliance_category") ? String(current.get("appliance_category")!.value) : null,
    });
    proposed = result.proposedFacts.map((f) => ({ key: f.key, value: f.value, certainty: f.certainty }));
    if (result.handoffRequested) handoffRequested = true;
    suggestedQuestionId = result.suggestedQuestionId;
    suggestedActionId = result.suggestedActionId;
    // Semantic hazard signals from the model are advisory: re-check deterministically.
    for (const s of result.hazardSignals) {
      const check = screenHazards(`${s.type} ${s.evidenceText}`);
      if (check.length > 0 || s.possibleCurrentDanger) {
        const reply = s.type === "gas_leak" ? gasLeakScript(tenant.gasUtilityContact) : generalHazardScript(s.type);
        c.safetyStatus = "needs_review";
        c.version += 1;
        c.updatedAt = now;
        await store.updateCase(c);
        await persistAssistant(store, tenant.id, c, reply);
        return { reply, phase: c.conversationPhase, safetyStatus: c.safetyStatus, factsAdded: [], conflicts: [], questionId: null, actionId: null, modelMode };
      }
    }
  } catch (e) {
    if (!(e instanceof ModelFailure)) throw e;
    modelMode = "fallback";
    c.modelMode = "fallback";
    proposed = fallbackExtract(text, messageId).map((f) => ({ ...f, certainty: "uncertain" as const }));
    await store.addEvent({
      id: randomUUID(), tenantId: tenant.id, caseId: c.id, type: "model_failure",
      payload: { reason: "turn extraction failed; deterministic fallback" }, createdAt: now,
    });
  }

  // Consent: first customer message implies consent-to-process for the demo; record it.
  if (c.conversationPhase === "consent" && !current.has("consent")) {
    await addFact(store, tenant.id, c, { key: "consent", value: true, certainty: "explicit" }, messageId, null);
    current.set("consent", { id: "consent", tenantId: tenant.id, caseId: c.id, key: "consent", value: true, status: "reported", sourceMessageId: messageId, sourceAttachmentId: null, certainty: "explicit", createdAt: now, supersedesId: null, confirmedBy: null, confirmedAt: null });
    c.conversationPhase = "identification";
  }

  // 3. Validate + conflict-detect. Never silently choose on contradiction.
  const valid = proposed.filter((p) => isAllowedKey(p.key));
  const conflicts = detectConflicts(facts, valid);
  const factsAdded: string[] = [];
  if (conflicts.length > 0) {
    const con = conflicts[0];
    const reply =
      `I want to get this right: earlier you said ${con.key} was "${con.existing}", ` +
      `but now I understood "${con.proposed}". Which is correct?`;
    await persistAssistant(store, tenant.id, c, reply);
    c.version += 1;
    c.updatedAt = now;
    await store.updateCase(c);
    return { reply, phase: c.conversationPhase, safetyStatus: c.safetyStatus, factsAdded, conflicts, questionId: null, actionId: null, modelMode };
  }
  for (const p of valid) {
    // Skip re-adding identical values.
    const cur = current.get(p.key);
    if (cur && String(cur.value) === String(normalizeFact(p.key, p.value))) continue;
    // Corrections supersede: mark old, keep provenance.
    if (cur) await store.markFactSuperseded(tenant.id, cur.id);
    const nf = await addFact(store, tenant.id, c, p, messageId, null, cur?.id ?? null);
    current.set(p.key, nf);
    factsAdded.push(p.key);
  }

  // First substantive message becomes the complaint if none recorded.
  if (!current.has("problem_description") && text.trim().length > 0) {
    const nf = await addFact(store, tenant.id, c, { key: "problem_description", value: text.slice(0, 2000), certainty: "explicit" }, messageId, null);
    current.set("problem_description", nf);
    factsAdded.push("problem_description");
  }

  // 4. Service-area check.
  const zip = current.get("service_zip");
  if (zip && tenant.serviceZips && !tenant.serviceZips.includes(String(zip.value).slice(0, 5))) {
    c.disposition = "out_of_service_area";
    const reply =
      `Thanks — ${zip.value} is outside our current service area for ${tenant.name}. ` +
      `I can still prepare a summary you can share with another provider, or you can ask for a person. ` +
      `Would you like me to continue collecting details?`;
    c.version += 1;
    c.updatedAt = now;
    await store.updateCase(c);
    await persistAssistant(store, tenant.id, c, reply);
    return { reply, phase: c.conversationPhase, safetyStatus: c.safetyStatus, factsAdded, conflicts, questionId: null, actionId: null, modelMode };
  }

  // 5. Handoff request or review.
  if (handoffRequested || text.trim().toLowerCase() === "submit") {
    c.conversationPhase = "review";
    c.disposition = c.disposition === "pending" ? "ready_for_review" : c.disposition;
    const reply = summarizeForReview(tenant, current);
    c.version += 1;
    c.updatedAt = now;
    await store.updateCase(c);
    await persistAssistant(store, tenant.id, c, reply);
    return { reply, phase: c.conversationPhase, safetyStatus: c.safetyStatus, factsAdded, conflicts, questionId: null, actionId: null, modelMode };
  }

  // 6. Next question: validate any suggested ID, else engine selection.
  const factKeys = new Set([...current.keys()]);
  const category = current.get("appliance_category") ? String(current.get("appliance_category")!.value) : null;
  let chosen = null as ReturnType<typeof findQuestion> | null;
  if (suggestedQuestionId) {
    const q = findQuestion(suggestedQuestionId);
    if (q && !asked.has(q.id) && !(q.factKey && factKeys.has(q.factKey)) &&
        q.preconditions.every((p) => factKeys.has(p))) {
      chosen = q;
    }
  }
  if (!chosen) {
    chosen = nextQuestion({ factKeys, askedIds: asked, category, hazardTypes: [], diagnosticCount: c.diagnosticQuestionsAsked });
  }
  if (!chosen) {
    c.conversationPhase = "review";
    const reply = summarizeForReview(tenant, current);
    c.version += 1;
    c.updatedAt = now;
    await store.updateCase(c);
    await persistAssistant(store, tenant.id, c, reply);
    return { reply, phase: c.conversationPhase, safetyStatus: c.safetyStatus, factsAdded, conflicts, questionId: null, actionId: null, modelMode };
  }

  // Validate suggested action too (shown alongside the question when allowed).
  let actionText = "";
  let actionId: string | null = null;
  if (suggestedActionId) {
    const a = findAction(suggestedActionId);
    if (a && a.preconditions.every((p) => factKeys.has(p))) {
      actionText = `\n\nOptional safe check: ${a.instruction}`;
      actionId = a.action_id;
    }
  }

  let reply = chosen.text;
  if (modelMode === "fallback") {
    reply = `I can still collect your details and send them to the service team.\n\n${chosen.text}`;
  }
  reply += actionText;
  if (containsForbiddenAction(reply)) {
    // Defense in depth: strip to the approved question text only.
    reply = chosen.text;
    actionId = null;
  }
  if (c.conversationPhase === "identification" && ["q_brand", "q_model", "q_age"].includes(chosen.id)) {
    c.conversationPhase = "questioning";
  }
  if (!["q_category", "q_problem", "q_zip", "q_brand", "q_model", "q_age", "q_name", "q_contact", "q_window"].includes(chosen.id)) {
    c.diagnosticQuestionsAsked += 1;
  }
  c.version += 1;
  c.updatedAt = now;
  await store.updateCase(c);
  await store.addEvent({
    id: randomUUID(), tenantId: tenant.id, caseId: c.id, type: "question_asked",
    payload: { questionId: chosen.id }, createdAt: now,
  });
  await persistAssistant(store, tenant.id, c, reply);
  return { reply, phase: c.conversationPhase, safetyStatus: c.safetyStatus, factsAdded, conflicts, questionId: chosen.id, actionId, modelMode };
}

async function persistAssistant(store: Store, tenantId: string, c: CaseRecord, body: string): Promise<Message> {
  const m: Message = {
    id: randomUUID(), tenantId, caseId: c.id, role: "assistant",
    body: body.slice(0, 4000), createdAt: new Date().toISOString(),
  };
  await store.addMessage(m);
  return m;
}

async function addFact(
  store: Store, tenantId: string, c: CaseRecord,
  p: { key: string; value: string | number | boolean | null; certainty: "explicit" | "inferred" | "uncertain" },
  messageId: string | null, attachmentId: string | null, supersedesId: string | null = null
): Promise<CaseFact> {
  const f: CaseFact = {
    id: randomUUID(), tenantId, caseId: c.id, key: p.key,
    value: isUnknownValue(p.value) && typeof p.value === "string" ? p.value : normalizeFact(p.key, p.value),
    status: p.certainty === "explicit" ? "reported" : "extracted",
    sourceMessageId: messageId, sourceAttachmentId: attachmentId,
    certainty: isUnknownValue(p.value) ? "uncertain" : p.certainty,
    createdAt: new Date().toISOString(), supersedesId,
    confirmedBy: null, confirmedAt: null,
  };
  await store.addFact(f);
  return f;
}

// ---- Label photo processing ----
export interface LabelOutcome {
  reply: string;
  modelRaw: string | null;
  confirmed: boolean;
  ambiguous: boolean;
}

const AMBIGUOUS_CHAR = /[O0Il1]/;

export async function processLabelPhoto(
  deps: EngineDeps, tenant: TenantConfig, caseId: string, attachmentId: string
): Promise<LabelOutcome> {
  const store = deps.store;
  const c = await store.getCase(tenant.id, caseId);
  if (!c) throw new Error("case not found");
  const atts = await store.listAttachments(tenant.id, caseId);
  const att = atts.find((a) => a.id === attachmentId);
  if (!att) throw new Error("attachment not found");
  const now = new Date().toISOString();

  // Test/dev hook: raw OCR text injected on the attachment is authoritative input
  // for parsing; otherwise call the vision model.
  let rawText = att.rawOcrText ?? "";
  let brand: string | null = null;
  let serial: string | null = null;
  let ambiguous = false;
  const uncertainty: string[] = [];
  if (!rawText) {
    try {
      const buf = await deps.storageGet(att.storageKey);
      const b64 = (buf ?? Buffer.alloc(0)).toString("base64");
      const lr = await deps.provider.extractApplianceLabel({
        tenantId: tenant.id, caseId: c.id, attachmentId, imageBase64: b64, mimeType: att.mimeType,
      });
      rawText = lr.rawText;
      brand = lr.brand;
      serial = lr.serialNumber;
      ambiguous = lr.ambiguousChars;
      uncertainty.push(...lr.uncertainty);
      await store.updateAttachmentOcr(tenant.id, attachmentId, rawText);
    } catch (e) {
      if (!(e instanceof ModelFailure)) throw e;
      const reply = `I couldn't read that photo automatically. Please type the brand and model number exactly as shown on the label, or say "label inaccessible" to continue without it.`;
      await persistAssistant(store, tenant.id, c, reply);
      return { reply, modelRaw: null, confirmed: false, ambiguous: false };
    }
  }
  if (!rawText) {
    const reply = `I couldn't read that photo automatically. Please type the brand and model number exactly as shown on the label, or say "label inaccessible" to continue without it.`;
    await persistAssistant(store, tenant.id, c, reply);
    return { reply, modelRaw: null, confirmed: false, ambiguous: false };
  }

  // Parse model candidate from raw text: longest alphanumeric token with a digit.
  const tokens = rawText.match(/[A-Z0-9][A-Z0-9.\-/]{3,}/gi) ?? [];
  const withDigit = tokens.filter((t) => /\d/.test(t));
  withDigit.sort((a, b) => b.length - a.length);
  const modelRaw = withDigit[0]?.trim() ?? null;
  if (modelRaw && AMBIGUOUS_CHAR.test(modelRaw)) ambiguous = true;

  const facts = await store.listFacts(tenant.id, caseId);
  const current = latestFacts(facts);
  if (modelRaw) {
    const norm = normalizeModel(modelRaw);
    if (current.get("model_number_raw")) await store.markFactSuperseded(tenant.id, current.get("model_number_raw")!.id);
    await addFact(store, tenant.id, c, { key: "model_number_raw", value: modelRaw, certainty: "explicit" }, null, attachmentId);
    // Ambiguous characters stay unresolved: do NOT set model_number as exact.
    if (!ambiguous) {
      if (current.get("model_number")) await store.markFactSuperseded(tenant.id, current.get("model_number")!.id);
      await addFact(store, tenant.id, c, { key: "model_number", value: modelRaw, certainty: "explicit" }, null, attachmentId);
    }
    void norm;
  }
  if (brand) {
    if (current.get("brand")) await store.markFactSuperseded(tenant.id, current.get("brand")!.id);
    await addFact(store, tenant.id, c, { key: "brand", value: brand, certainty: "explicit" }, null, attachmentId);
  }
  if (serial) {
    await addFact(store, tenant.id, c, { key: "serial_number", value: serial, certainty: "explicit" }, null, attachmentId);
  }
  await store.addEvent({
    id: randomUUID(), tenantId: tenant.id, caseId: c.id, type: "label_processed",
    payload: { attachmentId, modelRaw, ambiguous, uncertainty }, createdAt: now,
  });

  let reply: string;
  if (!modelRaw) {
    reply = `I couldn't find a model number in that photo. Please type it exactly as shown, or say "label inaccessible" to continue without it.`;
  } else if (ambiguous) {
    reply = `I read the model as ${modelRaw}, but some characters are unclear (for example O vs 0). Please confirm the exact model letter by letter, or type it exactly as shown.`;
  } else {
    reply = `I read the model as ${modelRaw}. Is that correct?`;
  }
  await persistAssistant(store, tenant.id, c, reply);
  return { reply, modelRaw, confirmed: false, ambiguous };
}

// Confirm a model number from the customer's reply ("yes" or a corrected value).
export async function confirmModel(
  deps: EngineDeps, tenant: TenantConfig, caseId: string, messageId: string, text: string
): Promise<{ confirmed: boolean; model: string | null }> {
  const store = deps.store;
  const c = await store.getCase(tenant.id, caseId);
  if (!c) throw new Error("case not found");
  const facts = await store.listFacts(tenant.id, caseId);
  const current = latestFacts(facts);
  const raw = current.get("model_number_raw")?.value ?? current.get("model_number")?.value;
  if (!raw) return { confirmed: false, model: null };
  const lower = text.trim().toLowerCase();
  if (/^(yes|yeah|yep|correct|that's right|confirmed)\b/.test(lower)) {
    if (current.get("model_number")) await store.markFactSuperseded(tenant.id, current.get("model_number")!.id);
    await addFact(store, tenant.id, c, { key: "model_number", value: String(raw), certainty: "explicit" }, messageId, null);
    await addFact(store, tenant.id, c, { key: "model_confirmed", value: true, certainty: "explicit" }, messageId, null);
    return { confirmed: true, model: String(raw) };
  }
  // A typed correction replaces the model (verbatim, suffixes preserved).
  const candidate = text.trim().slice(0, 120);
  if (candidate.length >= 3 && /[A-Z0-9]/i.test(candidate)) {
    if (current.get("model_number")) await store.markFactSuperseded(tenant.id, current.get("model_number")!.id);
    await addFact(store, tenant.id, c, { key: "model_number", value: candidate, certainty: "explicit" }, messageId, null);
    await addFact(store, tenant.id, c, { key: "model_confirmed", value: true, certainty: "explicit" }, messageId, null);
    return { confirmed: true, model: candidate };
  }
  return { confirmed: false, model: null };
}

// ---- Submission + handoff ----
export async function submitCase(
  deps: EngineDeps, tenant: TenantConfig, caseId: string
): Promise<{ handoffVersion: number; assessment: Assessment }> {
  const store = deps.store;
  const c = await store.getCase(tenant.id, caseId);
  if (!c) throw new Error("case not found");
  if (c.conversationPhase === "submitted") throw new Error("already submitted");
  const now = new Date().toISOString();
  const facts = (await store.listFacts(tenant.id, caseId)).filter((f) => f.status !== "superseded");
  const byKey = new Map(facts.map((f) => [f.key, f]));

  // Retrieval for assessment (approved docs only, tenant-isolated).
  const docs = await store.listDocuments(tenant.id);
  const chunks = await store.listChunks(tenant.id);
  const docMap = new Map(docs.map((d) => [d.id, d]));
  const modelVal = byKey.get("model_number")?.value;
  const confirmed = byKey.get("model_confirmed")?.value === true;
  const hits = retrieveKnowledge({
    chunks, documents: docMap, tenantId: tenant.id,
    modelNormalized: modelVal && confirmed ? normalizeModel(String(modelVal)) : null,
    brand: byKey.get("brand") ? String(byKey.get("brand")!.value) : null,
    category: byKey.get("appliance_category") ? String(byKey.get("appliance_category")!.value) : null,
    query: `${byKey.get("problem_description")?.value ?? ""} ${byKey.get("error_code")?.value ?? ""} ${byKey.get("failure_stage")?.value ?? ""}`,
    limit: 4,
  });
  const level = hits.length === 0 ? "unknown" : hits[0].level;

  let assessment: Assessment;
  try {
    const ar = await deps.provider.assessCase({
      tenantId: tenant.id, caseId: c.id,
      facts: facts.map((f) => ({ id: f.id, key: f.key, value: f.value })),
      chunks: hits.map((h) => ({ id: h.chunk.id, documentId: h.chunk.documentId, page: h.chunk.pageLabel, text: h.chunk.text })),
      knowledgeLevel: level,
    });
    // Validate citations resolve to supplied chunks; drop invalid ones.
    const supplied = hits;
    const hyps = ar.hypotheses.slice(0, 3).map((h) => {
      const v = validateCitations(h.sourceChunkIds.map((id) => ({ chunkId: id })), supplied);
      return { ...h, sourceChunkIds: h.sourceChunkIds.filter((id) => !v.invalidIds.includes(id)) };
    });
    assessment = {
      id: randomUUID(), tenantId: tenant.id, caseId: c.id, status: "ok",
      hypotheses: hyps.slice(0, 3),
      recommendedFollowUp: ar.recommendedFollowUp,
      knowledgeLevel: level,
      citations: hits.map((h) => ({ chunkId: h.chunk.id, documentId: h.chunk.documentId, page: h.chunk.pageLabel, quote: h.chunk.text.slice(0, 280) })),
      createdAt: now,
    };
  } catch (e) {
    if (!(e instanceof ModelFailure)) throw e;
    assessment = {
      id: randomUUID(), tenantId: tenant.id, caseId: c.id, status: "assessment_unavailable",
      hypotheses: [], recommendedFollowUp: "Model assessment unavailable — review collected facts and contact the customer.",
      knowledgeLevel: level,
      citations: hits.map((h) => ({ chunkId: h.chunk.id, documentId: h.chunk.documentId, page: h.chunk.pageLabel, quote: h.chunk.text.slice(0, 280) })),
      createdAt: now,
    };
    await store.addEvent({
      id: randomUUID(), tenantId: tenant.id, caseId: c.id, type: "model_failure",
      payload: { reason: "assessment failed; factual summary only" }, createdAt: now,
    });
  }
  await store.saveAssessment(assessment);

  // Immutable handoff snapshot.
  const existing = await store.listHandoffs(tenant.id, caseId);
  const version = existing.length + 1;
  const messages = await store.listMessages(tenant.id, caseId);
  const atts = await store.listAttachments(tenant.id, caseId);
  const missingRequired = tenant.requiredFields.filter((k) => !byKey.has(k));
  const snapshot = {
    case_reference: c.reference,
    submitted_at: now,
    organization: { id: tenant.id, name: tenant.name, demo: tenant.demoLabel, type: tenant.orgType },
    intake_source: c.source,
    contact: { name: byKey.get("contact_name")?.value ?? null, channel: byKey.get("contact_channel")?.value ?? null },
    service_zip: byKey.get("service_zip")?.value ?? null,
    street_address: byKey.get("street_address")?.value ?? null,
    appliance: {
      category: byKey.get("appliance_category")?.value ?? null,
      brand: byKey.get("brand")?.value ?? null,
      model: byKey.get("model_number")?.value ?? null,
      model_raw: byKey.get("model_number_raw")?.value ?? null,
      model_confirmed: byKey.get("model_confirmed")?.value ?? false,
      label_inaccessible: byKey.get("label_inaccessible")?.value ?? false,
      serial: byKey.get("serial_number")?.value ?? null,
      age: byKey.get("appliance_age")?.value ?? null,
    },
    complaint: byKey.get("problem_description")?.value ?? null,
    facts: facts.map((f) => ({ id: f.id, key: f.key, value: f.value, status: f.status, certainty: f.certainty, source_message: f.sourceMessageId, source_attachment: f.sourceAttachmentId })),
    error_codes_verbatim: [byKey.get("error_code")?.value, byKey.get("display_reading")?.value].filter(Boolean),
    safety: { status: c.safetyStatus, disposition: c.disposition },
    hypotheses: assessment.hypotheses,
    assessment_status: assessment.status,
    knowledge_level: assessment.knowledgeLevel,
    citations: assessment.citations,
    missing_information: missingRequired,
    preferred_window: byKey.get("preferred_window")?.value ?? null,
    recommended_follow_up: assessment.recommendedFollowUp,
    attachments: atts.map((a) => ({ id: a.id, kind: a.kind, mime: a.mimeType, sha256: a.sha256 })),
    transcript_message_ids: messages.map((m) => m.id),
    model_mode: c.modelMode,
    handoff_version: version,
  };
  await store.saveHandoff({ version, caseId: c.id, tenantId: tenant.id, createdAt: now, snapshot });

  c.conversationPhase = "submitted";
  c.workflowStatus = "new";
  c.submittedAt = now;
  c.version += 1;
  c.updatedAt = now;
  await store.updateCase(c);
  await store.addEvent({
    id: randomUUID(), tenantId: tenant.id, caseId: c.id, type: "case_submitted",
    payload: { handoffVersion: version }, createdAt: now,
  });
  // Transactional outbox: enqueue webhook fan-out with the submission.
  await store.enqueueJob({
    id: randomUUID(), tenantId: tenant.id, caseId: c.id, kind: "webhook",
    payload: { eventType: "case.submitted", handoffVersion: version },
    status: "pending", attempts: 0, maxAttempts: 8, leaseUntil: null,
    lastError: null, createdAt: now, updatedAt: now,
  });
  return { handoffVersion: version, assessment };
}
