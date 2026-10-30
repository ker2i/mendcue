// Model provider contract. Application code validates everything the model returns.
import { z } from "zod";

export class ModelFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelFailure";
  }
}

// Runtime schemas: every live-model JSON payload is validated here and
// converted to a typed ModelFailure. TypeScript casts alone are not used.
const ProposedFactSchema = z.object({
  key: z.string().min(1).max(80),
  value: z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]),
  certainty: z.enum(["explicit", "inferred", "uncertain"]),
});

const HazardSignalSchema = z.object({
  type: z.string().min(1).max(60),
  evidenceText: z.string().max(500),
  possibleCurrentDanger: z.boolean(),
});

export const IntakeTurnResultSchema = z.object({
  proposedFacts: z.array(ProposedFactSchema).max(30),
  hazardSignals: z.array(HazardSignalSchema).max(10),
  suggestedQuestionId: z.string().max(80).nullable().optional(),
  suggestedActionId: z.string().max(80).nullable().optional(),
  needsClarification: z.boolean(),
  handoffRequested: z.boolean(),
  unresolvedItems: z.array(z.string().max(200)).max(20),
});

export const LabelResultSchema = z.object({
  brand: z.string().max(80).nullable().optional(),
  modelRaw: z.string().max(120).nullable().optional(),
  serialNumber: z.string().max(120).nullable().optional(),
  categoryGuess: z.string().max(60).nullable().optional(),
  electricalInfo: z.string().max(300).nullable().optional(),
  rawText: z.string().max(4000),
  uncertainty: z.array(z.string().max(300)).max(10),
  ambiguousChars: z.boolean(),
});

const HypothesisSchema = z.object({
  issueArea: z.string().min(1).max(500),
  priority: z.enum(["primary", "alternative"]),
  evidenceStrength: z.enum(["limited", "moderate", "strong"]),
  supportingFactIds: z.array(z.string().max(80)).max(20),
  contradictingFactIds: z.array(z.string().max(80)).max(20),
  sourceChunkIds: z.array(z.string().max(80)).max(10),
  limitations: z.array(z.string().max(500)).max(10),
});

export const AssessmentResultSchema = z.object({
  hypotheses: z.array(HypothesisSchema).max(3),
  recommendedFollowUp: z.string().max(1000),
});

export function parseTurnResult(raw: unknown): z.infer<typeof IntakeTurnResultSchema> {
  const p = IntakeTurnResultSchema.safeParse(raw);
  if (!p.success) throw new ModelFailure("invalid turn output shape");
  return p.data;
}

export function parseLabelResult(raw: unknown): z.infer<typeof LabelResultSchema> {
  const p = LabelResultSchema.safeParse(raw);
  if (!p.success) throw new ModelFailure("invalid label output shape");
  return p.data;
}

export function parseAssessmentResult(raw: unknown): z.infer<typeof AssessmentResultSchema> {
  const p = AssessmentResultSchema.safeParse(raw);
  if (!p.success) throw new ModelFailure("invalid assessment output shape");
  return p.data;
}

export interface ProposedFact {
  key: string;
  value: string | number | boolean | null;
  sourceMessageId: string;
  sourceAttachmentId: string | null;
  certainty: "explicit" | "inferred" | "uncertain";
}

export interface HazardSignal {
  type: string;
  evidenceText: string;
  possibleCurrentDanger: boolean;
}

export interface IntakeTurnResult {
  proposedFacts: ProposedFact[];
  hazardSignals: HazardSignal[];
  suggestedQuestionId: string | null;
  suggestedActionId: string | null;
  needsClarification: boolean;
  handoffRequested: boolean;
  unresolvedItems: string[];
}

export interface IntakeTurnInput {
  tenantId: string;
  caseId: string;
  messageId: string;
  messageText: string;
  knownFacts: Array<{ key: string; value: unknown }>;
  askedQuestionIds: string[];
  allowedQuestionIds: string[];
  allowedActionIds: string[];
  category: string | null;
  // Conversation context so short answers ("three years", "both") resolve
  // against the actual question instead of being interpreted in isolation.
  activeQuestion: { id: string; text: string } | null;
  recentMessages: Array<{ role: string; body: string }>;
}

export interface LabelInput {
  tenantId: string;
  caseId: string;
  attachmentId: string;
  imageBase64: string;
  mimeType: string;
}

export interface LabelResult {
  brand: string | null;
  modelRaw: string | null;
  modelNormalized: string | null;
  serialNumber: string | null;
  categoryGuess: string | null;
  electricalInfo: string | null;
  rawText: string;
  uncertainty: string[];
  ambiguousChars: boolean; // O/0, I/1 confusion present
}

export interface AssessmentInput {
  sourceMetadata?: Array<Record<string, unknown>>;
  images?: Array<{ mimeType: string; imageBase64: string }>;
  tenantId: string;
  caseId: string;
  facts: Array<{ id: string; key: string; value: unknown }>;
  chunks: Array<{ id: string; documentId: string; page: string | null; text: string }>;
  knowledgeLevel: "exact_model" | "verified_family" | "category_only" | "unknown";
}

export interface AssessmentResult {
  hypotheses: Array<{
    issueArea: string;
    priority: "primary" | "alternative";
    evidenceStrength: "limited" | "moderate" | "strong";
    supportingFactIds: string[];
    contradictingFactIds: string[];
    sourceChunkIds: string[];
    limitations: string[];
  }>;
  recommendedFollowUp: string;
}

export interface ModelProvider {
  readonly mode: "live" | "fixture";
  extractIntakeTurn(input: IntakeTurnInput): Promise<IntakeTurnResult>;
  extractApplianceLabel(input: LabelInput): Promise<LabelResult>;
  assessCase(input: AssessmentInput): Promise<AssessmentResult>;
}
