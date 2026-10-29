// In-memory store for tests and local dev without Postgres.
// Every read enforces tenantId; cross-tenant access returns null/[].
import type { Assessment, Attachment, CaseEvent, CaseFact, CaseRecord, Handoff, Message, TenantConfig } from "../domain/types.js";
import type { KnowledgeChunk, KnowledgeDocument } from "../domain/knowledge.js";
import type { JobRecord, OutcomeRecord, ServiceCredential, SessionRecord, StaffSession, StaffUser, Store, WebhookDelivery, WebhookEndpoint } from "./store.js";

export class MemoryStore implements Store {
  tenants = new Map<string, TenantConfig>();
  cases = new Map<string, CaseRecord>();
  messages: Message[] = [];
  facts: CaseFact[] = [];
  attachments: Attachment[] = [];
  sessions = new Map<string, SessionRecord>();
  assessments = new Map<string, Assessment>();
  handoffs: Handoff[] = [];
  events: CaseEvent[] = [];
  documents = new Map<string, KnowledgeDocument>();
  chunks = new Map<string, KnowledgeChunk>();
  jobs: JobRecord[] = [];
  idem = new Map<string, string>();
  endpoints = new Map<string, WebhookEndpoint>();
  deliveries: WebhookDelivery[] = [];
  staff = new Map<string, StaffUser>();
  staffSessions = new Map<string, StaffSession>();
  svcCreds = new Map<string, ServiceCredential>();
  outcomes = new Map<string, OutcomeRecord>();

  async getTenant(id: string) { return this.tenants.get(id) ?? null; }
  async getTenantBySlug(slug: string) {
    for (const t of this.tenants.values()) if (t.slug === slug) return t;
    return null;
  }
  async getTenantByPublicKey(key: string) {
    for (const t of this.tenants.values()) if (t.publicKey === key) return t;
    return null;
  }
  async listTenants() { return [...this.tenants.values()]; }
  async saveTenant(t: TenantConfig) { this.tenants.set(t.id, structuredClone(t)); }

  async createCase(c: CaseRecord) { this.cases.set(c.id, structuredClone(c)); }
  async getCase(tenantId: string, caseId: string) {
    const c = this.cases.get(caseId);
    if (!c || c.tenantId !== tenantId) return null;
    return structuredClone(c);
  }
  async getCaseAnyTenant(caseId: string) {
    const c = this.cases.get(caseId);
    return c ? structuredClone(c) : null;
  }
  async updateCase(c: CaseRecord) { this.cases.set(c.id, structuredClone(c)); }
  async listCases(tenantId: string) {
    return [...this.cases.values()].filter((c) => c.tenantId === tenantId).map((c) => structuredClone(c));
  }

  async addMessage(m: Message) { this.messages.push(structuredClone(m)); }
  async listMessages(tenantId: string, caseId: string) {
    return this.messages.filter((m) => m.tenantId === tenantId && m.caseId === caseId).map((m) => structuredClone(m));
  }
  async addFact(f: CaseFact) { this.facts.push(structuredClone(f)); }
  async listFacts(tenantId: string, caseId: string) {
    return this.facts.filter((f) => f.tenantId === tenantId && f.caseId === caseId).map((f) => structuredClone(f));
  }
  async markFactSuperseded(tenantId: string, factId: string) {
    const f = this.facts.find((x) => x.id === factId && x.tenantId === tenantId);
    if (f) f.status = "superseded";
  }
  async addAttachment(a: Attachment) { this.attachments.push(structuredClone(a)); }
  async listAttachments(tenantId: string, caseId: string) {
    return this.attachments.filter((a) => a.tenantId === tenantId && a.caseId === caseId).map((a) => structuredClone(a));
  }
  async updateAttachmentOcr(tenantId: string, attachmentId: string, rawText: string) {
    const a = this.attachments.find((x) => x.id === attachmentId && x.tenantId === tenantId);
    if (a) a.rawOcrText = rawText;
  }
  async countAttachments(tenantId: string, caseId: string) {
    return this.attachments.filter((a) => a.tenantId === tenantId && a.caseId === caseId).length;
  }

  async createSession(s: SessionRecord) { this.sessions.set(s.id, structuredClone(s)); }
  async getSessionByTokenHash(hash: string) {
    for (const s of this.sessions.values()) if (s.tokenHash === hash) return structuredClone(s);
    return null;
  }
  async getSessionByBootstrapHash(hash: string) {
    for (const s of this.sessions.values()) if (s.bootstrapCodeHash === hash) return structuredClone(s);
    return null;
  }
  async markBootstrapUsed(id: string) {
    const s = this.sessions.get(id);
    if (s) { s.bootstrapUsed = true; s.bootstrapCodeHash = null; }
  }

  async saveAssessment(a: Assessment) { this.assessments.set(`${a.tenantId}:${a.caseId}`, structuredClone(a)); }
  async getAssessment(tenantId: string, caseId: string) {
    return structuredClone(this.assessments.get(`${tenantId}:${caseId}`) ?? null);
  }
  async saveHandoff(h: Handoff) { this.handoffs.push(structuredClone(h)); }
  async listHandoffs(tenantId: string, caseId: string) {
    return this.handoffs.filter((h) => h.tenantId === tenantId && h.caseId === caseId).map((h) => structuredClone(h));
  }
  async addEvent(e: CaseEvent) { this.events.push(structuredClone(e)); }
  async listEvents(tenantId: string, caseId: string) {
    return this.events.filter((e) => e.tenantId === tenantId && e.caseId === caseId).map((e) => structuredClone(e));
  }

  async saveDocument(d: KnowledgeDocument) { this.documents.set(d.id, structuredClone(d)); }
  async saveChunk(c: KnowledgeChunk) { this.chunks.set(c.id, structuredClone(c)); }
  async listDocuments(tenantId: string) {
    return [...this.documents.values()].filter((d) => d.visibility === "shared" || d.tenantId === tenantId).map((d) => structuredClone(d));
  }
  async listChunks(tenantId: string) {
    return [...this.chunks.values()].filter((c) => c.visibility === "shared" || c.tenantId === tenantId).map((c) => structuredClone(c));
  }
  async getDocument(id: string) { return structuredClone(this.documents.get(id) ?? null); }

  async enqueueJob(j: JobRecord) { this.jobs.push(structuredClone(j)); }
  async leaseJob(now: string) {
    const job = this.jobs.find((j) =>
      j.status === "pending" || (j.status === "leased" && j.leaseUntil !== null && j.leaseUntil < now));
    if (!job) return null;
    job.status = "leased";
    job.attempts += 1;
    job.leaseUntil = new Date(Date.now() + 60000).toISOString();
    job.updatedAt = now;
    return structuredClone(job);
  }
  async completeJob(id: string) {
    const j = this.jobs.find((x) => x.id === id);
    if (j) { j.status = "done"; j.updatedAt = new Date().toISOString(); }
  }
  async failJob(id: string, error: string, retryAt: string | null) {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) return;
    j.lastError = error;
    j.updatedAt = new Date().toISOString();
    if (retryAt && j.attempts < j.maxAttempts) { j.status = "pending"; j.leaseUntil = null; }
    else j.status = "failed";
  }
  async hasPendingTurnJob(caseId: string) {
    return this.jobs.some((j) => j.caseId === caseId && j.kind === "turn" && (j.status === "pending" || j.status === "leased"));
  }

  async idempotencyGet(tenantId: string, key: string) { return this.idem.get(`${tenantId}:${key}`) ?? null; }
  async idempotencyPut(tenantId: string, key: string, responseHash: string) { this.idem.set(`${tenantId}:${key}`, responseHash); }

  async saveEndpoint(e: WebhookEndpoint) { this.endpoints.set(e.id, structuredClone(e)); }
  async listEndpoints(tenantId: string) {
    return [...this.endpoints.values()].filter((e) => e.tenantId === tenantId).map((e) => structuredClone(e));
  }
  async saveDelivery(d: WebhookDelivery) { this.deliveries.push(structuredClone(d)); }
  async listDeliveries(tenantId: string) {
    return this.deliveries.filter((d) => d.tenantId === tenantId).map((d) => structuredClone(d));
  }

  async saveStaffUser(u: StaffUser) { this.staff.set(u.id, structuredClone(u)); }
  async getStaffByEmail(tenantId: string, email: string) {
    for (const u of this.staff.values()) {
      if (u.tenantId === tenantId && u.email.toLowerCase() === email.toLowerCase()) return structuredClone(u);
    }
    return null;
  }
  async createStaffSession(s: StaffSession) { this.staffSessions.set(s.id, structuredClone(s)); }
  async getStaffSession(id: string) { return structuredClone(this.staffSessions.get(id) ?? null); }
  async saveServiceCredential(c: ServiceCredential) { this.svcCreds.set(c.id, structuredClone(c)); }
  async getServiceCredentialByHash(hash: string) {
    for (const c of this.svcCreds.values()) if (c.keyHash === hash) return structuredClone(c);
    return null;
  }
  async saveOutcome(o: OutcomeRecord) { this.outcomes.set(`${o.tenantId}:${o.caseId}`, structuredClone(o)); }
  async getOutcome(tenantId: string, caseId: string) {
    return structuredClone(this.outcomes.get(`${tenantId}:${caseId}`) ?? null);
  }
}
