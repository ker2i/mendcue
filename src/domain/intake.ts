import { inferenceImage } from "../integrations/storage/images.js";
import { webhookJob } from "./outbox.js";
// Shared tenant-aware intake engine. Used by widget, hosted site, dashboard, API.
import { randomUUID } from "node:crypto";
import type { Assessment, CaseFact, CaseRecord, Message, PendingAction, TenantConfig } from "./types.js";
import type { HazardHit } from "./safety.js";
import { detectConflicts, isAllowedKey, isUnknownValue, normalizeFact } from "./facts.js";
import { containsForbiddenAction, gasLeakScript, generalHazardScript, screenHazards } from "./safety.js";
import { findAction, findQuestion, nextQuestion, questionRationale } from "./questions.js";
import { normalizeModel, evidenceReference, retrieveKnowledge } from "./knowledge.js";
import { groundedIssueAreas } from "./brief.js";
import { parseLabelText } from "./labelparse.js";
import type { AssessmentInput, ModelProvider } from "../integrations/meta/provider.js";
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
    pendingAction: null,
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

// Hazard types currently constraining questions/actions, from the latest
// hazard event. Conservative: any unresolved safety state keeps exclusions.
async function activeHazardTypes(store: Store, tenantId: string, caseId: string, safetyStatus: string): Promise<string[]> {
  if (safetyStatus === "unchecked" || safetyStatus === "no_hazard_reported") return [];
  const events = await store.listEvents(tenantId, caseId);
  const flagged = [...events].reverse().find((e) => e.type === "hazard_flagged");
  const hits = (flagged?.payload?.hits as Array<{ type?: string }> | undefined) ?? [];
  const types = hits.map((h) => h.type).filter((t): t is string => typeof t === "string");
  return types.length > 0 ? types : ["unknown_hazard"];
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

// Shared hazard response. Called synchronously from the message route in
// queued mode (before any job is enqueued) and from processTurn.
export async function handleHazardTurn(
  deps: EngineDeps, tenant: TenantConfig, c: CaseRecord, hits: HazardHit[]
): Promise<TurnOutcome> {
  const now = new Date().toISOString();
  const gas = hits.find((h) => h.type === "gas_leak");
  const reply = gas ? gasLeakScript(tenant.gasUtilityContact) : generalHazardScript(hits[0].type);
  c.safetyStatus = gas ? "emergency" : "stop_use";
  c.version += 1;
  c.updatedAt = now;
  await deps.store.updateCase(c);
  await persistAssistant(deps.store, tenant.id, c, reply);
  await deps.store.addEvent({
    id: randomUUID(), tenantId: tenant.id, caseId: c.id, type: "hazard_flagged",
    payload: { hits }, createdAt: now,
  });
  return { reply, phase: c.conversationPhase, safetyStatus: c.safetyStatus, factsAdded: [], conflicts: [], questionId: null, actionId: null, modelMode: c.modelMode };
}

const AFFIRMATIVE = /^(yes|yeah|yep|yup|correct|that'?s right|confirmed|right|ok|okay|sure)\b/i;
const NEGATIVE = /^(no|nope|wrong|not right|incorrect)\b/i;
// Single-token model-like correction: alnum with digit, no spaces.
const MODEL_LIKE = /^[A-Z0-9][A-Z0-9.\-/]{2,39}$/i;

function isModelLikeCorrection(text: string): boolean {
  const t = text.trim();
  if (/\s/.test(t)) return false;
  if (!MODEL_LIKE.test(t)) return false;
  if (!/\d/.test(t)) return false;
  // All-digit short tokens are ZIPs/quantities, not model corrections.
  if (/^\d+$/.test(t) && t.length < 6) return false;
  return true;
}

// Attempt to resolve the case's pending decision from this reply.
// Returns a TurnOutcome when the reply resolves it, or null to continue
// with the normal turn pipeline (pending state is retained).
async function resolvePendingAction(
  deps: EngineDeps, tenant: TenantConfig, c: CaseRecord,
  messageId: string, text: string, current: Map<string, CaseFact>
): Promise<TurnOutcome | null> {
  const pending: PendingAction = c.pendingAction;
  if (!pending) return null;
  const store = deps.store;
  const now = new Date().toISOString();
  const done = async (reply: string, factsAdded: string[] = []): Promise<TurnOutcome> => {
    c.pendingAction = null;
    c.version += 1;
    c.updatedAt = now;
    await store.updateCase(c);
    await persistAssistant(store, tenant.id, c, reply);
    return { reply, phase: c.conversationPhase, safetyStatus: c.safetyStatus, factsAdded, conflicts: [], questionId: null, actionId: null, modelMode: c.modelMode };
  };

  if (pending.kind === "model_confirm") {
    if (AFFIRMATIVE.test(text.trim())) {
      const cur = current.get("model_number");
      if (cur) await store.markFactSuperseded(tenant.id, cur.id);
      await addFact(store, tenant.id, c, { key: "model_number", value: pending.modelRaw, certainty: "explicit" }, messageId, null);
      await addFact(store, tenant.id, c, { key: "model_confirmed", value: true, certainty: "explicit" }, messageId, null);
      return done(`Thanks — model recorded as ${pending.modelRaw}.`, ["model_number", "model_confirmed"]);
    }
    if (NEGATIVE.test(text.trim())) {
      return done(`No problem — please type the model number exactly as shown on the label, or say "label inaccessible" to continue without it.`);
    }
    if (isModelLikeCorrection(text)) {
      const candidate = text.trim();
      const cur = current.get("model_number");
      if (cur) await store.markFactSuperseded(tenant.id, cur.id);
      await addFact(store, tenant.id, c, { key: "model_number", value: candidate, certainty: "explicit" }, messageId, null);
      await addFact(store, tenant.id, c, { key: "model_confirmed", value: true, certainty: "explicit" }, messageId, null);
      return done(`Thanks — model recorded as ${candidate}.`, ["model_number", "model_confirmed"]);
    }
    return null; // Normal conversation; pending confirmation stays open.
  }

  if (pending.kind === "conflict") {
    const t = text.trim().toLowerCase();
    const existing = String(pending.existing ?? "").toLowerCase();
    const proposed = String(pending.proposed ?? "").toLowerCase();
    if (t === existing || (existing && t.includes(existing))) {
      return done(`Got it — keeping ${pending.key} as "${pending.existing}".`);
    }
    if (t === proposed || (proposed && t.includes(proposed))) {
      const cur = current.get(pending.key);
      if (cur) await store.markFactSuperseded(tenant.id, cur.id);
      await addFact(store, tenant.id, c, { key: pending.key, value: pending.proposed as string | number | boolean | null, certainty: "explicit" }, messageId, null, cur?.id ?? null);
      return done(`Updated — ${pending.key} is now "${pending.proposed}". The earlier value is preserved in history.`, [pending.key]);
    }
    if (isModelLikeCorrection(text) && pending.key === "model_number") {
      const cur = current.get(pending.key);
      if (cur) await store.markFactSuperseded(tenant.id, cur.id);
      await addFact(store, tenant.id, c, { key: pending.key, value: text.trim(), certainty: "explicit" }, messageId, null, cur?.id ?? null);
      return done(`Updated — ${pending.key} is now "${text.trim()}".`, [pending.key]);
    }
    return null;
  }

  if (pending.kind === "out_of_area") {
    if (/submit|summary|human|person/i.test(text)) {
      await addFact(store, tenant.id, c, { key: "service_area_acknowledged", value: true, certainty: "explicit" }, messageId, null);
      c.conversationPhase = "review";
      const reply = summarizeForReview(tenant, current);
      c.pendingAction = null;
      c.version += 1;
      c.updatedAt = now;
      await store.updateCase(c);
      await persistAssistant(store, tenant.id, c, reply);
      return { reply, phase: c.conversationPhase, safetyStatus: c.safetyStatus, factsAdded: ["service_area_acknowledged"], conflicts: [], questionId: null, actionId: null, modelMode: c.modelMode };
    }
    if (/^(yes|yeah|yep|sure|ok|okay|please|continue)\b/i.test(text.trim())) {
      await addFact(store, tenant.id, c, { key: "service_area_acknowledged", value: true, certainty: "explicit" }, messageId, null);
      return done(`Understood — I'll keep collecting details for a summary you can share with another provider, and you can ask for a person at any time.`, ["service_area_acknowledged"]);
    }
    return null;
  }

  return null;
}

export async function processTurn(
  deps: EngineDeps, tenant: TenantConfig, caseId: string, messageId: string, text: string,
  opts: { consent?: boolean } = {}
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

  // 1. Immediate deterministic hazard check — before any model call,
  // confirmation shortcut, or other branch. This is the ONLY entry point
  // for customer turns, so no route can bypass it.
  const hits = screenHazards(text);
  if (hits.length > 0) {
    return handleHazardTurn(deps, tenant, c, hits);
  }
  if (c.safetyStatus === "unchecked") {
    c.safetyStatus = "no_hazard_reported";
  }
  // Hazard state stays active until an explicit transition. A customer
  // "safe" report downgrades to needs_review for staff; it never clears.
  if ((c.safetyStatus === "emergency" || c.safetyStatus === "stop_use") &&
      /\b(i'?m safe|we'?re safe|all clear|no (longer|more) (danger|smell|smoke|sparking)|safe now)\b/i.test(text)) {
    c.safetyStatus = "needs_review";
    c.version += 1;
    c.updatedAt = now;
    await store.updateCase(c);
    await store.addEvent({
      id: randomUUID(), tenantId: tenant.id, caseId: c.id, type: "hazard_downgraded",
      payload: { by: "customer_safe_report", to: "needs_review" }, createdAt: now,
    });
  }

  // 1b. Resolve explicit pending decisions BEFORE normal extraction.
  // Only affirmative/negation/valid-correction answers resolve a model
  // confirmation; anything else falls through to normal conversation.
  if (c.pendingAction) {
    const resolved = await resolvePendingAction(deps, tenant, c, messageId, text, current);
    if (resolved) return resolved;
  }

  // 2. Model extraction with graceful fallback.
  let modelMode: string = deps.provider.mode;
  let proposed: Array<{ key: string; value: string | number | boolean | null; certainty: "explicit" | "inferred" | "uncertain" }> = [];
  let handoffRequested = /\b(submit|that's all|talk to (a )?person|human|done|finish)\b/i.test(text);
  let suggestedQuestionId: string | null = null;
  let suggestedActionId: string | null = null;
  try {
    const qmod = await import("./questions.js");
    const allowedQ = qmod.QUESTIONS.map((q) => q.id);
    const allowedA = qmod.CUSTOMER_ACTIONS
      .filter((a) => a.reviewStatus === "approved").map((a) => a.action_id);
    // Active question + recent turns so short answers resolve in context.
    const events = await store.listEvents(tenant.id, c.id);
    const lastAsked = [...events].reverse().find((e) => e.type === "question_asked");
    const activeQ = lastAsked ? qmod.findQuestion(String(lastAsked.payload.questionId)) : undefined;
    const history = await store.listMessages(tenant.id, c.id);
    const result = await deps.provider.extractIntakeTurn({
      tenantId: tenant.id, caseId: c.id, messageId, messageText: text,
      knownFacts: [...current.entries()].map(([key, f]) => ({ key, value: f.value })),
      askedQuestionIds: [...asked], allowedQuestionIds: allowedQ, allowedActionIds: allowedA,
      category: current.get("appliance_category") ? String(current.get("appliance_category")!.value) : null,
      activeQuestion: activeQ ? { id: activeQ.id, text: activeQ.text } : null,
      recentMessages: history.slice(-6).map((m) => ({ role: m.role, body: m.body.slice(0, 500) })),
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

  // Consent: recorded exactly as the client sends it. The customer UI shows
  // a processing disclosure with an explicit control; intake itself is never
  // blocked (hazard reports must always get through), but an absent consent
  // stays honestly unknown instead of being auto-recorded as given.
  if (c.conversationPhase === "consent" && !current.has("consent")) {
    const consentValue = opts?.consent === true ? true : opts?.consent === false ? false : null;
    const nf = await addFact(store, tenant.id, c, { key: "consent", value: consentValue, certainty: consentValue === null ? "uncertain" : "explicit" }, messageId, null);
    current.set("consent", nf);
    c.conversationPhase = "identification";
  }

  // 3. Validate + conflict-detect. Never silently choose on contradiction.
  const valid = proposed.filter((p) => isAllowedKey(p.key) && !["model_confirmed", "consent", "service_area_acknowledged"].includes(p.key));
  const conflicts = detectConflicts(facts, valid);
  const factsAdded: string[] = [];
  if (conflicts.length > 0) {
    const con = conflicts[0];
    const reply =
      `I want to get this right: earlier you said ${con.key} was "${con.existing}", ` +
      `but now I understood "${con.proposed}". Which is correct?`;
    await persistAssistant(store, tenant.id, c, reply);
    c.pendingAction = { kind: "conflict", key: con.key, existing: con.existing, proposed: con.proposed };
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
  // A directly supplied model (or explicit confirmation) retires any stale
  // label-confirmation prompt so a later "yes" can't revive old OCR text.
  if (c.pendingAction?.kind === "model_confirm" &&
      (factsAdded.includes("model_number") || factsAdded.includes("model_confirmed") || factsAdded.includes("label_inaccessible"))) {
    c.pendingAction = null;
  }

  // First substantive message becomes the complaint if none recorded.
  if (!current.has("problem_description") && text.trim().length > 0) {
    const nf = await addFact(store, tenant.id, c, { key: "problem_description", value: text.slice(0, 2000), certainty: "explicit" }, messageId, null);
    current.set("problem_description", nf);
    factsAdded.push("problem_description");
  }

  // 4. Service-area check (skipped once the customer acknowledges it).
  const zip = current.get("service_zip");
  const acked = current.get("service_area_acknowledged")?.value === true;
  if (zip && tenant.serviceZips && !tenant.serviceZips.includes(String(zip.value).slice(0, 5)) && !acked) {
    c.disposition = "out_of_service_area";
    const reply =
      `Thanks — ${zip.value} is outside our current service area for ${tenant.name}. ` +
      `I can still prepare a summary you can share with another provider, or you can ask for a person. ` +
      `Would you like me to continue collecting details?`;
    c.pendingAction = { kind: "out_of_area", zip: String(zip.value) };
    c.version += 1;
    c.updatedAt = now;
    await store.updateCase(c);
    await persistAssistant(store, tenant.id, c, reply);
    return { reply, phase: c.conversationPhase, safetyStatus: c.safetyStatus, factsAdded, conflicts, questionId: null, actionId: null, modelMode };
  }

  // 5. Handoff request or review. Text confirmation while already in
  // review follows the same transition as the "Send request" button.
  const submitIntent = /^(submit|send(\s+(it|my request|the request))?|confirm|yes[,.]?\s*(send|submit|please send))\.?$/i.test(text.trim());
  if (handoffRequested || text.trim().toLowerCase() === "submit") {
    if (c.conversationPhase === "review" && submitIntent) {
      try {
        const { handoffVersion } = await submitCase(deps, tenant, c.id);
        const submitted = await store.getCase(tenant.id, c.id);
        const reply =
          `Your request has been sent to ${tenant.name}. Your reference is ${submitted!.reference} ` +
          `(handoff v${handoffVersion}). The ${tenant.routing.queue} will follow up. ` +
          `Scheduling is confirmed by the service team, not by this chat.`;
        await persistAssistant(store, tenant.id, submitted!, reply);
        return { reply, phase: "submitted", safetyStatus: submitted!.safetyStatus, factsAdded, conflicts, questionId: null, actionId: null, modelMode };
      } catch (e) {
        if (e instanceof SubmitRejected) {
          const reply =
            e.code === "INCOMPLETE"
              ? `Before I send this: ${e.message} Missing: ${e.missing.join(", ")}. ` +
                `Reply with the missing details, or say "send incomplete" to send it as is.`
              : e.message;
          await persistAssistant(store, tenant.id, c, reply);
          return { reply, phase: c.conversationPhase, safetyStatus: c.safetyStatus, factsAdded, conflicts, questionId: null, actionId: null, modelMode };
        }
        throw e;
      }
    }
    // "send incomplete" is the explicit incomplete route over text.
    if (c.conversationPhase === "review" && /^send incomplete\.?$/i.test(text.trim())) {
      const { handoffVersion } = await submitCase(deps, tenant, c.id, { acknowledgeIncomplete: true });
      const submitted = await store.getCase(tenant.id, c.id);
      const reply =
        `Your request has been sent to ${tenant.name} as incomplete. Your reference is ${submitted!.reference} ` +
        `(handoff v${handoffVersion}). The ${tenant.routing.queue} will follow up.`;
      await persistAssistant(store, tenant.id, submitted!, reply);
      return { reply, phase: "submitted", safetyStatus: submitted!.safetyStatus, factsAdded, conflicts, questionId: null, actionId: null, modelMode };
    }
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
  // Suggested IDs must satisfy everything the engine checks: existence,
  // enabled version, category, preconditions, and hazard exclusions.
  const factKeys = new Set([...current.keys()]);
  const category = current.get("appliance_category") ? String(current.get("appliance_category")!.value) : null;
  const activeHazards = await activeHazardTypes(store, tenant.id, c.id, c.safetyStatus);
  const versionOk = (playbook: string, version: string): boolean => {
    const want = tenant.playbookVersions[playbook];
    if (!want) return true;
    return want === version;
  };
  let chosen = null as ReturnType<typeof findQuestion> | null;
  if (suggestedQuestionId) {
    const q = findQuestion(suggestedQuestionId);
    if (q && !asked.has(q.id) && !(q.factKey && factKeys.has(q.factKey)) &&
        q.preconditions.every((p) => factKeys.has(p)) &&
        (!q.categories || !category || q.categories.includes(category)) &&
        !q.exclusions.some((e) => activeHazards.includes(e)) &&
        versionOk(q.playbook, q.version)) {
      chosen = q;
    }
  }
  if (!chosen) {
    chosen = nextQuestion({ factKeys, askedIds: asked, category, hazardTypes: activeHazards, diagnosticCount: c.diagnosticQuestionsAsked, playbookVersions: tenant.playbookVersions });
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
    if (a && a.preconditions.every((p) => factKeys.has(p)) &&
        (!a.categories || !category || a.categories.includes(category)) &&
        !a.hazardExclusions.some((e) => activeHazards.includes(e)) &&
        versionOk(a.playbook, a.version)) {
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
    payload: { questionId: chosen.id, version: chosen.version, factKey: chosen.factKey, rationale: questionRationale(chosen.id) }, createdAt: now,
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

export async function invalidateIdentity(store: Store, tenantId: string, caseId: string, key: string): Promise<void> {
  if (!["brand", "model_number", "model_number_raw"].includes(key)) return;
  for (const f of await store.listFacts(tenantId, caseId)) {
    if (f.key === "model_confirmed" && f.status !== "superseded") await store.markFactSuperseded(tenantId, f.id);
  }
  await store.clearAssessment(tenantId, caseId);
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
  await invalidateIdentity(store, tenantId, c.id, p.key);
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
  let providerModelRaw: string | null = null;
  let ambiguous = false;
  const uncertainty: string[] = [];
  if (!rawText) {
    try {
      const buf = await deps.storageGet(att.storageKey);
      if (!buf) throw new ModelFailure("Private image missing");
      const derivative = deps.provider.mode === "live" ? await inferenceImage(buf) : buf;
      const b64 = derivative.toString("base64");
      const lr = await deps.provider.extractApplianceLabel({
        tenantId: tenant.id, caseId: c.id, attachmentId, imageBase64: b64, mimeType: deps.provider.mode === "live" ? "image/jpeg" : att.mimeType,
      });
      rawText = lr.rawText;
      brand = lr.brand;
      serial = lr.serialNumber;
      providerModelRaw = lr.modelRaw;
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

  // Structured provider fields win; otherwise label-aware parsing keeps the
  // serial separate so it can never replace the model (R08).
  let modelRaw: string | null = providerModelRaw;
  let basis = "vision model field";
  if (!modelRaw) {
    const parsed = parseLabelText(rawText);
    modelRaw = parsed.modelRaw;
    if (parsed.serial && !serial) serial = parsed.serial;
    if (parsed.ambiguous) ambiguous = true;
    basis = parsed.basis;
  }

  const facts = await store.listFacts(tenant.id, caseId);
  const current = latestFacts(facts);
  if (modelRaw) {
    if (current.get("model_number_raw")) await store.markFactSuperseded(tenant.id, current.get("model_number_raw")!.id);
    await addFact(store, tenant.id, c, { key: "model_number_raw", value: modelRaw, certainty: "explicit" }, null, attachmentId);
    // Ambiguous characters stay unresolved: do NOT set model_number as exact.
    if (!ambiguous) {
      if (current.get("model_number")) await store.markFactSuperseded(tenant.id, current.get("model_number")!.id);
      await addFact(store, tenant.id, c, { key: "model_number", value: modelRaw, certainty: "explicit" }, null, attachmentId);
    }
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
    payload: { attachmentId, brand, modelRaw, serial, rawText, basis, ambiguous, uncertainty }, createdAt: now,
  });
  if (modelRaw) {
    c.pendingAction = { kind: "model_confirm", modelRaw, attachmentId };
    c.version += 1;
    c.updatedAt = now;
    await store.updateCase(c);
  }

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

// Explicit model confirmation from the label card (no free-text parsing).
// decision "yes" confirms the pending OCR value; "correction" supplies an
// edited value; "no" clears the prompt. Anything else is rejected — callers
// must send other replies through the normal message pipeline.
export async function confirmModelExplicit(
  deps: EngineDeps, tenant: TenantConfig, caseId: string,
  decision: { confirm: boolean; correctedModel?: string; brand?: string; serialNumber?: string }
): Promise<{ confirmed: boolean; model: string | null }> {
  const store = deps.store;
  const c = await store.getCase(tenant.id, caseId);
  if (!c) throw new Error("case not found");
  if (["submitted", "closed"].includes(c.conversationPhase)) return { confirmed: false, model: null };
  const pending = c.pendingAction?.kind === "model_confirm" ? c.pendingAction : null;
  if (!pending && !decision.correctedModel) return { confirmed: false, model: null };
  const facts = await store.listFacts(tenant.id, caseId);
  const current = latestFacts(facts);
  const now = new Date().toISOString();
  if (!decision.confirm) {
    c.pendingAction = null;
    c.version += 1;
    c.updatedAt = now;
    await store.updateCase(c);
    return { confirmed: false, model: null };
  }
  const candidate = (decision.correctedModel ?? pending?.modelRaw ?? "").trim().slice(0, 120);
  if (!isModelLikeCorrection(candidate) && candidate !== pending?.modelRaw) {
    return { confirmed: false, model: null };
  }
  if (current.get("model_number")) await store.markFactSuperseded(tenant.id, current.get("model_number")!.id);
  for (const [key, value] of [["brand", decision.brand], ["serial_number", decision.serialNumber]] as const) {
    if (value === undefined) continue;
    if (current.get(key)) await store.markFactSuperseded(tenant.id, current.get(key)!.id);
    await addFact(store, tenant.id, c, { key, value, certainty: "explicit" }, null, pending?.attachmentId ?? null);
  }
  if (current.get("model_number_raw")) await store.markFactSuperseded(tenant.id, current.get("model_number_raw")!.id);
  await addFact(store, tenant.id, c, { key: "model_number_raw", value: candidate, certainty: "explicit" }, null, pending?.attachmentId ?? null);
  await addFact(store, tenant.id, c, { key: "model_number", value: candidate, certainty: "explicit" }, null, pending?.attachmentId ?? null);
  await addFact(store, tenant.id, c, { key: "model_confirmed", value: true, certainty: "explicit" }, null, pending?.attachmentId ?? null);
  c.pendingAction = null;
  c.version += 1;
  c.updatedAt = now;
  await store.updateCase(c);
  await store.addEvent({
    id: randomUUID(), tenantId: tenant.id, caseId: c.id, type: "model_confirmed",
    payload: { model: candidate, brand: decision.brand ?? current.get("brand")?.value ?? null, attachmentId: pending?.attachmentId ?? null }, createdAt: now,
  });
  return { confirmed: true, model: candidate };
}

// ---- Submission + handoff ----
export class SubmitRejected extends Error {
  code: "REVIEW_REQUIRED" | "INCOMPLETE";
  missing: string[];
  constructor(code: "REVIEW_REQUIRED" | "INCOMPLETE", missing: string[], message: string) {
    super(message);
    this.name = "SubmitRejected";
    this.code = code;
    this.missing = missing;
  }
}

export interface ReviewSection {
  id: string;
  title: string;
  rows: Array<{ key: string; label: string; value: string | number | boolean | null; missing: boolean; editable: boolean }>;
}

export interface ReviewState {
  phase: string;
  businessName: string;
  queue: string;
  sections: ReviewSection[];
  missing: string[];
  requiresIncompleteAck: boolean;
  hazardRoute: boolean;
}

const REVIEW_ROWS: Array<{ section: string; title: string; key: string; label: string }> = [
  { section: "appliance", title: "Appliance", key: "appliance_category", label: "Category" },
  { section: "appliance", title: "Appliance", key: "brand", label: "Brand" },
  { section: "appliance", title: "Appliance", key: "model_number", label: "Model" },
  { section: "appliance", title: "Appliance", key: "model_confirmed", label: "Identification confirmed" },
  { section: "appliance", title: "Appliance", key: "appliance_age", label: "Age" },
  { section: "issue", title: "Reported issue", key: "problem_description", label: "Description" },
  { section: "issue", title: "Reported issue", key: "error_code", label: "Error code (verbatim)" },
  { section: "issue", title: "Reported issue", key: "display_reading", label: "Display reading" },
  { section: "issue", title: "Reported issue", key: "failure_stage", label: "When it happens" },
  { section: "observations", title: "Observations", key: "cooling_scope", label: "Cooling scope" },
  { section: "observations", title: "Observations", key: "sound_observation", label: "Sounds" },
  { section: "observations", title: "Observations", key: "leak_observation", label: "Leak / ice" },
  { section: "observations", title: "Observations", key: "drain_observation", label: "Drainage" },
  { section: "observations", title: "Observations", key: "load_observation", label: "Load" },
  { section: "location", title: "Location and contact", key: "service_zip", label: "Service ZIP" },
  { section: "location", title: "Location and contact", key: "street_address", label: "Street address" },
  { section: "location", title: "Location and contact", key: "contact_name", label: "Name" },
  { section: "location", title: "Location and contact", key: "contact_channel", label: "Phone or email" },
  { section: "preferences", title: "Preferences", key: "preferred_window", label: "Callback / visit window" },
];

export function buildReview(tenant: TenantConfig, facts: CaseFact[], phase: string, safetyStatus: string): ReviewState {
  const current = latestFacts(facts);
  const sections = new Map<string, ReviewSection>();
  for (const r of REVIEW_ROWS) {
    if (!sections.has(r.section)) sections.set(r.section, { id: r.section, title: r.title, rows: [] });
    const f = current.get(r.key);
    sections.get(r.section)!.rows.push({
      key: r.key, label: r.label,
      value: f ? f.value : null,
      missing: !f || f.value === null,
      editable: r.key !== "model_confirmed",
    });
  }
  const missing = tenant.requiredFields.filter((k) => {
    const f = current.get(k);
    return !f || f.value === null;
  });
  const hazardRoute = ["emergency", "stop_use", "needs_review"].includes(safetyStatus);
  return {
    phase, businessName: tenant.name, queue: tenant.routing.queue,
    sections: [...sections.values()], missing,
    requiresIncompleteAck: missing.length > 0 && !hazardRoute,
    hazardRoute,
  };
}

export async function submitCase(
  deps: EngineDeps, tenant: TenantConfig, caseId: string,
  opts: { acknowledgeIncomplete?: boolean } = {}
): Promise<{ handoffVersion: number; assessment: Assessment }> {
  const store = deps.store;
  const c = await store.getCase(tenant.id, caseId);
  if (!c) throw new Error("case not found");
  if (c.submittedAt) {
    const handoffs = await store.listHandoffs(tenant.id, caseId);
    const assessment = await store.getAssessment(tenant.id, caseId);
    if (!handoffs.length || !assessment) throw new Error("inconsistent submission");
    return { handoffVersion: handoffs[handoffs.length - 1].version, assessment };
  }
  const facts = (await store.listFacts(tenant.id, caseId)).filter((f) => f.status !== "superseded");
  const byKey = new Map(facts.map((f) => [f.key, f]));
  const missingRequired = tenant.requiredFields.filter((k) => !byKey.has(k));
  const hazardRoute = ["emergency", "stop_use", "needs_review"].includes(c.safetyStatus);
  // Ordinary requests must pass through review; an empty case can never be
  // submitted by accident. Hazard cases take the explicit emergency route.
  const hasContent = byKey.has("problem_description") || facts.length > 0;
  if (c.conversationPhase !== "review" && (!hazardRoute || !hasContent)) {
    throw new SubmitRejected("REVIEW_REQUIRED", missingRequired, "Please review your details before sending the request.");
  }
  if (missingRequired.length > 0 && !hazardRoute && !opts.acknowledgeIncomplete) {
    throw new SubmitRejected("INCOMPLETE", missingRequired, "Some required details are missing. Confirm you want to send an incomplete request.");
  }
  const now = new Date().toISOString();
  const incompleteAcknowledged = missingRequired.length > 0 && !hazardRoute && opts.acknowledgeIncomplete === true;

  // Retrieval for assessment (approved docs only, tenant-isolated).
  const docs = await store.listDocuments(tenant.id);
  const chunks = await store.listChunks(tenant.id);
  const activeDocs = deps.provider.mode === "live" ? docs.filter(d => !d.reviewedBy?.startsWith("example-content")) : docs;
  const docMap = new Map(activeDocs.map((d) => [d.id, d]));
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
    const assessmentInput: AssessmentInput = {
      tenantId: tenant.id, caseId: c.id,
      facts: facts.map((f) => ({ id: f.id, key: f.key, value: f.value })),
      chunks: hits.map((h) => ({ id: h.chunk.id, documentId: h.chunk.documentId, page: h.chunk.pageLabel, text: h.chunk.text })),
      knowledgeLevel: level,
      sourceMetadata: hits.map(h => { const {excerpt, ...metadata}=evidenceReference(h,docMap); return metadata; }),
    };
    if(deps.provider.mode==="live"){
      const photo=(await store.listAttachments(tenant.id,caseId)).filter(a=>a.kind==="label_photo").at(-1);
      if(photo){
        const bytes=await deps.storageGet(photo.storageKey);
        if(!bytes)throw new ModelFailure("Label photo unavailable");
        assessmentInput.images=[{mimeType:"image/jpeg",imageBase64:(await inferenceImage(bytes)).toString("base64")}];
      }
    }
    const ar = await deps.provider.assessCase(assessmentInput);
    const hyps = groundedIssueAreas(ar, facts);
    assessment = {
      id: randomUUID(), tenantId: tenant.id, caseId: c.id, status: "ok",
      hypotheses: hyps.slice(0, 3),
      recommendedFollowUp: "Review the collected observations and applicable sources, confirm identity, and contact the customer about missing information. Technician diagnosis is required.",
      knowledgeLevel: level,
      citations: hits.map((h) => ({ ...evidenceReference(h, docMap), page: h.chunk.pageLabel, quote: h.chunk.text.slice(0, 280) })),
      createdAt: now,
    };
  } catch (e) {
    if (!(e instanceof ModelFailure)) throw e;
    assessment = {
      id: randomUUID(), tenantId: tenant.id, caseId: c.id, status: "assessment_unavailable",
      hypotheses: [], recommendedFollowUp: "Model assessment unavailable — review collected facts and contact the customer.",
      knowledgeLevel: level,
      citations: hits.map((h) => ({ ...evidenceReference(h, docMap), page: h.chunk.pageLabel, quote: h.chunk.text.slice(0, 280) })),
      createdAt: now,
    };

  }
  // Assessment and immutable snapshot are persisted together below.

  // Immutable handoff snapshot.
  const existing = await store.listHandoffs(tenant.id, caseId);
  const version = existing.length + 1;
  const messages = await store.listMessages(tenant.id, caseId);
  const atts = await store.listAttachments(tenant.id, caseId);
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
    incomplete_acknowledged: incompleteAcknowledged,
    hazard_route: hazardRoute,
    preferred_window: byKey.get("preferred_window")?.value ?? null,
    recommended_follow_up: assessment.recommendedFollowUp,
    attachments: atts.map((a) => ({ id: a.id, kind: a.kind, mime: a.mimeType, sha256: a.sha256, source_sha256: a.sourceSha256 ?? null })),
    transcript_message_ids: messages.map((m) => m.id),
    model_mode: c.modelMode,
    handoff_version: version,
  };
  const expectedVersion = c.version;
  c.conversationPhase = "submitted";
  c.workflowStatus = "new";
  c.submittedAt = now;
  c.version += 1;
  c.updatedAt = now;
  const committed = await store.commitCase({
    record: c, expectedVersion, assessment,
    handoff: { version, caseId: c.id, tenantId: tenant.id, createdAt: now, snapshot },
    events: [{ id: randomUUID(), tenantId: tenant.id, caseId: c.id, type: "case_submitted",
      payload: { handoffVersion: version }, createdAt: now }],
    jobs: [webhookJob(c, "case.submitted", version), ...(tenant.notifications.emailEnabled && tenant.notifications.emailTo ? [{
      id: randomUUID(), tenantId: tenant.id, caseId: c.id, kind: "notification",
      payload: { to: tenant.notifications.emailTo, reference: c.reference,
        staffUrl: `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/staff#case=${encodeURIComponent(c.id)}` },
      status: "pending" as const, attempts: 0, maxAttempts: 8, leaseUntil: null, lastError: null, createdAt: now, updatedAt: now,
    }] : [])],
  });
  if (!committed) {
    const current = await store.getCase(tenant.id, caseId);
    if (current?.submittedAt) return submitCase(deps, tenant, caseId, opts);
    throw new SubmitRejected("REVIEW_REQUIRED", [], "This case changed. Review the latest details before sending.");
  }
  return { handoffVersion: version, assessment };
}
