// Store interface implemented by Postgres (production) and memory (tests/dev).
import type {
  Assessment, Attachment, CaseEvent, CaseFact, CaseRecord, Handoff, Hypothesis, Message, TenantConfig,
} from "../domain/types.js";
import type { KnowledgeChunk, KnowledgeDocument } from "../domain/knowledge.js";

export interface SessionRecord {
  id: string;
  tenantId: string;
  caseId: string;
  tokenHash: string;
  bootstrapCodeHash: string | null;
  bootstrapUsed: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface StaffUser {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  role: "owner" | "dispatcher" | "technician" | "readonly";
  name: string;
}

export interface StaffSession { id: string; userId: string; tenantId: string; createdAt: string; expiresAt: string }

export interface ServiceCredential { id: string; tenantId: string; name: string; keyHash: string; scopes: string[]; createdAt: string }

export interface JobRecord {
  id: string; tenantId: string; caseId: string | null; kind: string;
  payload: Record<string, unknown>; status: "pending" | "leased" | "done" | "failed";
  attempts: number; maxAttempts: number; leaseUntil: string | null;
  availableAt?: string; operatorRetries?: number; leaseVersion?: number;
  lastError: string | null; createdAt: string; updatedAt: string;
}

export interface WebhookEndpoint { id: string; tenantId: string; url: string; secret: string; events: string[]; active: boolean }
export interface WebhookDelivery { id: string; tenantId: string; endpointId: string; eventId: string; eventType: string; status: string; attempts: number; lastError: string | null; createdAt: string }

export interface OutcomeRecord {
  caseId: string; tenantId: string; rating: string; confirmedIssue: string | null;
  hypothesesUseful: boolean | null; recordedBy: string; recordedAt: string;
}

export interface CaseCommit {
  record: CaseRecord; expectedVersion: number; events: CaseEvent[]; jobs: JobRecord[];
  handoff?: Handoff; assessment?: Assessment;
}

export interface Store {
  // Compare-and-swap the case and commit its complete outbox in one transaction.
  commitCase(change: CaseCommit): Promise<boolean>;
  listJobs(tenantId: string): Promise<JobRecord[]>;
  retryJob(tenantId: string, id: string): Promise<boolean>;
  updateJobPayload(tenantId: string, id: string, payload: Record<string, unknown>): Promise<void>;

  purgeExpired(tenant: TenantConfig, now: string): Promise<number>;
  // tenants
  getTenant(id: string): Promise<TenantConfig | null>;
  getTenantBySlug(slug: string): Promise<TenantConfig | null>;
  getTenantByPublicKey(key: string): Promise<TenantConfig | null>;
  listTenants(): Promise<TenantConfig[]>;
  saveTenant(t: TenantConfig): Promise<void>;

  // cases
  createCase(c: CaseRecord): Promise<void>;
  getCase(tenantId: string, caseId: string): Promise<CaseRecord | null>;
  updateCase(c: CaseRecord): Promise<void>;
  listCases(tenantId: string): Promise<CaseRecord[]>;

  // messages / facts / attachments
  addMessage(m: Message): Promise<void>;
  listMessages(tenantId: string, caseId: string): Promise<Message[]>;
  addFact(f: CaseFact): Promise<void>;
  listFacts(tenantId: string, caseId: string): Promise<CaseFact[]>;
  markFactSuperseded(tenantId: string, factId: string): Promise<void>;
  addAttachment(a: Attachment): Promise<void>;
  listAttachments(tenantId: string, caseId: string): Promise<Attachment[]>;
  updateAttachmentOcr(tenantId: string, attachmentId: string, rawText: string): Promise<void>;
  countAttachments(tenantId: string, caseId: string): Promise<number>;

  // sessions
  createSession(s: SessionRecord): Promise<void>;
  getSessionByTokenHash(hash: string): Promise<SessionRecord | null>;
  // Atomically consume a single-use bootstrap code. Returns the session only
  // when the code exists, is unused, and is unexpired; concurrent consumes
  // succeed exactly once.
  consumeBootstrap(hash: string, now: string): Promise<SessionRecord | null>;

  // assessments / handoffs / events
  saveAssessment(a: Assessment): Promise<void>;
  clearAssessment(tenantId: string, caseId: string): Promise<void>;
  getAssessment(tenantId: string, caseId: string): Promise<Assessment | null>;
  saveHandoff(h: Handoff): Promise<void>;
  listHandoffs(tenantId: string, caseId: string): Promise<Handoff[]>;
  addEvent(e: CaseEvent): Promise<void>;
  listEvents(tenantId: string, caseId: string): Promise<CaseEvent[]>;

  // knowledge
  saveDocument(d: KnowledgeDocument): Promise<void>;
  saveChunk(c: KnowledgeChunk): Promise<void>;
  listDocuments(tenantId: string): Promise<KnowledgeDocument[]>;
  listChunks(tenantId: string): Promise<KnowledgeChunk[]>;

  // jobs (durable queue)
  enqueueJob(j: JobRecord): Promise<void>;
  leaseJob(now: string): Promise<JobRecord | null>;
  completeJob(id: string, attempt?: number): Promise<void>;
  failJob(id: string, error: string, retryAt: string | null, attempt?: number): Promise<void>;
  // True when an older turn job for the case still needs processing first.
  olderTurnJobPending(caseId: string, beforeCreatedAt: string, excludeId: string): Promise<boolean>;

  // idempotency
  idempotencyGet(tenantId: string, key: string): Promise<string | null>;
  idempotencyPut(tenantId: string, key: string, responseHash: string): Promise<void>;

  // webhooks
  saveEndpoint(e: WebhookEndpoint): Promise<void>;
  listEndpoints(tenantId: string): Promise<WebhookEndpoint[]>;
  saveDelivery(d: WebhookDelivery): Promise<void>;
  listDeliveries(tenantId: string, eventId?: string): Promise<WebhookDelivery[]>;

  // staff / service / outcomes
  saveStaffUser(u: StaffUser): Promise<void>;
  getStaffByEmail(tenantId: string, email: string): Promise<StaffUser | null>;
  getStaffById(tenantId: string, id: string): Promise<StaffUser | null>;
  createStaffSession(s: StaffSession): Promise<void>;
  getStaffSession(id: string): Promise<StaffSession | null>;
  saveServiceCredential(c: ServiceCredential): Promise<void>;
  getServiceCredentialByHash(hash: string): Promise<ServiceCredential | null>;
  listServiceCredentials(tenantId: string): Promise<Array<{ name: string; scopes: string[]; createdAt: string }>>;
  saveOutcome(o: OutcomeRecord): Promise<void>;
  getOutcome(tenantId: string, caseId: string): Promise<OutcomeRecord | null>;
}

export function hypothesisToJson(h: Hypothesis): Hypothesis { return h; }
