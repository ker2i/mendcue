// Deterministic development fixture. NEVER presented as a live model result.
// Labeled in every response via modelMode:"fixture".
import type {
  AssessmentInput, AssessmentResult, IntakeTurnInput, IntakeTurnResult,
  LabelInput, LabelResult, ModelProvider, ProposedFact,
} from "./provider.js";

const BRANDS = ["lg", "samsung", "ge", "whirlpool", "bosch", "frigidaire", "maytag", "kenmore", "electrolux", "haier"];

function factsFromText(text: string, messageId: string): ProposedFact[] {
  const out: ProposedFact[] = [];
  const lower = text.toLowerCase();
  for (const b of BRANDS) {
    if (new RegExp(`\\b${b}\\b`, "i").test(text)) {
      out.push({ key: "brand", value: text.match(new RegExp(b, "i"))![0], sourceMessageId: messageId, sourceAttachmentId: null, certainty: "explicit" });
      break;
    }
  }
  if (/\b(refrigerator|fridge|freezer)\b/.test(lower)) {
    out.push({ key: "appliance_category", value: /\b(fridge|refrigerator)\b/.test(lower) ? "refrigerator" : "freezer", sourceMessageId: messageId, sourceAttachmentId: null, certainty: "explicit" });
  } else if (/\b(wash(er|ing)|laundry)\b/.test(lower)) {
    out.push({ key: "appliance_category", value: "washer", sourceMessageId: messageId, sourceAttachmentId: null, certainty: "explicit" });
  } else if (/\bdishwash/.test(lower)) {
    out.push({ key: "appliance_category", value: "dishwasher", sourceMessageId: messageId, sourceAttachmentId: null, certainty: "explicit" });
  }
  const zip = text.match(/\b\d{5}(?:-\d{4})?\b/);
  if (zip) out.push({ key: "service_zip", value: zip[0], sourceMessageId: messageId, sourceAttachmentId: null, certainty: "explicit" });
  // Error codes: keep verbatim, e.g. OE, E4, F21, H1.
  const code = text.match(/\b(?:error|code|shows?|says|display(?:s|ed)?)\b[^a-z0-9]{0,10}([A-Z]{1,2}\d{1,3}[A-Z]{0,2})\b/i)
    ?? text.match(/\b(OE|UE|LE|DE|HE|F\d{2}|E\d{1,2}|H\d)\b/);
  if (code) {
    const v = (code[1] ?? code[0]).toUpperCase();
    out.push({ key: "error_code", value: v, sourceMessageId: messageId, sourceAttachmentId: null, certainty: "explicit" });
  }
  if (/\b(fill|fills|filling)\b/.test(lower)) {
    out.push({ key: "failure_stage", value: lower.includes("drain") ? "filling/draining" : "filling", sourceMessageId: messageId, sourceAttachmentId: null, certainty: "inferred" });
  } else if (/\b(spin|spinning)\b/.test(lower)) {
    out.push({ key: "failure_stage", value: "spinning", sourceMessageId: messageId, sourceAttachmentId: null, certainty: "inferred" });
  } else if (/\bdrain/.test(lower)) {
    out.push({ key: "failure_stage", value: "draining", sourceMessageId: messageId, sourceAttachmentId: null, certainty: "inferred" });
  }
  if (lower.includes("i don't know") || lower.includes("dont know") || /\bunknown\b/.test(lower)) {
    // Generic unknown marker handled by engine via unresolvedItems.
  }
  // Contact heuristics.
  const phone = text.match(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  if (phone) out.push({ key: "contact_channel", value: phone[0], sourceMessageId: messageId, sourceAttachmentId: null, certainty: "explicit" });
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email && !phone) out.push({ key: "contact_channel", value: email[0], sourceMessageId: messageId, sourceAttachmentId: null, certainty: "explicit" });
  return out;
}

export class FixtureProvider implements ModelProvider {
  readonly mode = "fixture" as const;

  async extractIntakeTurn(input: IntakeTurnInput): Promise<IntakeTurnResult> {
    const text = input.messageText;
    const lower = text.toLowerCase();
    const proposedFacts = factsFromText(text, input.messageId);
    const handoffRequested =
      /\b(talk to (a )?person|human|agent|handoff|submit|done|that's all|finish)\b/.test(lower);
    const needsClarification = false;
    const unresolvedItems: string[] = [];
    if (/label inaccessible|cant find.*label|can't find.*label/i.test(text)) {
      proposedFacts.push({ key: "label_inaccessible", value: true, sourceMessageId: input.messageId, sourceAttachmentId: null, certainty: "explicit" });
    }
    return {
      proposedFacts,
      hazardSignals: [],
      suggestedQuestionId: null, // engine picks via registry
      suggestedActionId: null,
      needsClarification,
      handoffRequested,
      unresolvedItems,
    };
  }

  async extractApplianceLabel(input: LabelInput): Promise<LabelResult> {
    // Fixture cannot do OCR: return uncertain result so the engine asks for manual entry.
    // Tests that need a label result inject rawText via the attachments test hook instead.
    void input;
    return {
      brand: null, modelRaw: null, modelNormalized: null, serialNumber: null,
      categoryGuess: null, electricalInfo: null,
      rawText: "",
      uncertainty: ["fixture-mode: no vision model; manual entry required"],
      ambiguousChars: false,
    };
  }

  async assessCase(input: AssessmentInput): Promise<AssessmentResult> {
    const byKey = new Map(input.facts.map((f) => [f.key, f]));
    const findId = (k: string) => byKey.get(k)?.id;
    const supporting = [findId("problem_description"), findId("error_code"), findId("failure_stage")].filter(Boolean) as string[];
    const category = String(byKey.get("appliance_category")?.value ?? "appliance");
    if (input.knowledgeLevel === "unknown" || input.chunks.length === 0) {
      return {
        hypotheses: [{
          issueArea: `Unresolved ${category} issue — technician diagnosis required`,
          priority: "primary", evidenceStrength: "limited",
          supportingFactIds: supporting, contradictingFactIds: [],
          sourceChunkIds: [], limitations: ["No approved model-specific documentation available; preliminary assessment only."],
        }],
        recommendedFollowUp: "Technician to inspect on site; confirm model from rating label and run standard checks.",
      };
    }
    const chunkIds = input.chunks.slice(0, 2).map((c) => c.id);
    return {
      hypotheses: [{
        issueArea: `${category} malfunction consistent with reported symptoms (see cited playbook section)`,
        priority: "primary", evidenceStrength: "moderate",
        supportingFactIds: supporting, contradictingFactIds: [],
        sourceChunkIds: chunkIds, limitations: ["Preliminary intake assessment; technician must confirm on site."],
      }],
      recommendedFollowUp: "Review cited playbook section, verify symptom on arrival, and record confirmed findings.",
    };
  }
}
