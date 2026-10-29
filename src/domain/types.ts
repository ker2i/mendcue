// Shared domain types. UI routes and provider code must not redefine these.
export type OrgType = "solo_repair" | "repair_company" | "home_warranty" | "insurance";

export type ConversationPhase =
  | "consent"
  | "identification"
  | "questioning"
  | "review"
  | "submitted"
  | "closed";

export type WorkflowStatus =
  | "draft"
  | "new"
  | "reviewing"
  | "contacted"
  | "scheduled"
  | "closed"
  | "cancelled";

export type SafetyStatus =
  | "unchecked"
  | "no_hazard_reported"
  | "needs_review"
  | "stop_use"
  | "emergency";

export type Disposition =
  | "pending"
  | "ready_for_review"
  | "human_requested"
  | "customer_reports_resolved"
  | "out_of_service_area";

export type RecallState =
  | "not_checked"
  | "possible_match"
  | "confirmed_match"
  | "no_match_found"
  | "unavailable";

export type FactStatus = "reported" | "extracted" | "confirmed" | "superseded";

export interface TenantConfig {
  id: string;
  slug: string;
  name: string;
  demoLabel: string;
  orgType: OrgType;
  branding: { primaryColor: string; logoUrl: string | null };
  contact: { email: string | null; phone: string | null };
  timezone: string;
  languages: string[];
  allowedOrigins: string[];
  publicKey: string;
  categories: string[];
  detailedCategories: string[];
  serviceZips: string[] | null; // null = unrestricted
  requireStreetAddress: boolean;
  requiredFields: string[];
  playbookVersions: Record<string, string>;
  routing: { destination: string; queue: string };
  notifications: { emailEnabled: boolean; emailTo: string | null };
  retention: { draftDays: number; closedDays: number; logDays: number };
  privacyText: string;
  openingMessage: string;
  gasUtilityContact: string;
  featureFlags: { photos: boolean; knowledge: boolean; recall: boolean };
}

export interface CaseRecord {
  id: string;
  tenantId: string;
  reference: string;
  source: "widget" | "hosted" | "integration";
  conversationPhase: ConversationPhase;
  workflowStatus: WorkflowStatus;
  safetyStatus: SafetyStatus;
  disposition: Disposition;
  version: number;
  externalReference: string | null;
  diagnosticQuestionsAsked: number;
  modelMode: "live" | "fixture" | "fallback";
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
}

export interface Message {
  id: string;
  tenantId: string;
  caseId: string;
  role: "customer" | "assistant" | "system";
  body: string;
  createdAt: string;
}

export interface CaseFact {
  id: string;
  tenantId: string;
  caseId: string;
  key: string;
  value: string | number | boolean | null;
  status: FactStatus;
  sourceMessageId: string | null;
  sourceAttachmentId: string | null;
  certainty: "explicit" | "inferred" | "uncertain";
  createdAt: string;
  supersedesId: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface Attachment {
  id: string;
  tenantId: string;
  caseId: string;
  kind: "label_photo" | "error_display" | "other";
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  sha256: string;
  rawOcrText: string | null;
  createdAt: string;
}

export interface Hypothesis {
  issueArea: string;
  priority: "primary" | "alternative";
  evidenceStrength: "limited" | "moderate" | "strong";
  supportingFactIds: string[];
  contradictingFactIds: string[];
  sourceChunkIds: string[];
  limitations: string[];
}

export interface Assessment {
  id: string;
  tenantId: string;
  caseId: string;
  status: "ok" | "assessment_unavailable";
  hypotheses: Hypothesis[];
  recommendedFollowUp: string;
  knowledgeLevel: "exact_model" | "category_family" | "unknown";
  citations: Array<{ chunkId: string; documentId: string; page: string | null; quote: string }>;
  createdAt: string;
}

export interface Handoff {
  version: number;
  caseId: string;
  tenantId: string;
  createdAt: string;
  snapshot: Record<string, unknown>;
}

export interface CaseEvent {
  id: string;
  tenantId: string;
  caseId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "TENANT_MISMATCH",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "RATE_LIMITED",
  "CASE_VERSION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA",
  "MODEL_UNAVAILABLE",
  "ORIGIN_NOT_ALLOWED",
] as const;

export function errorBody(code: string, message: string, requestId: string) {
  return { error: { code, message, request_id: requestId } };
}
