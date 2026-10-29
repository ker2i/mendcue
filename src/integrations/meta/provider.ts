// Model provider contract. Application code validates everything the model returns.
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
  tenantId: string;
  caseId: string;
  facts: Array<{ id: string; key: string; value: unknown }>;
  chunks: Array<{ id: string; documentId: string; page: string | null; text: string }>;
  knowledgeLevel: "exact_model" | "category_family" | "unknown";
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

export class ModelFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelFailure";
  }
}
