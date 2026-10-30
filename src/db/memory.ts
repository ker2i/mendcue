import { randomUUID } from "node:crypto";
// In-memory store for tests and local dev without Postgres.
// Every read enforces tenantId; cross-tenant access returns null/[].
import type { Assessment, Attachment, CaseEvent, CaseFact, CaseRecord, Handoff, Message, TenantConfig } from "../domain/types.js";
import type { KnowledgeChunk, KnowledgeDocument } from "../domain/knowledge.js";
import type { CaseCommit, JobRecord, OutcomeRecord, ServiceCredential, SessionRecord, StaffSession, StaffUser, Store, WebhookDelivery, WebhookEndpoint } from "./store.js";

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

  async commitCase(input: CaseCommit) {
    // Clone/validate everything before mutation; no awaits inside the commit.
    const change = structuredClone(input);
    const { record: c, expectedVersion, events, jobs, handoff, assessment } = change;
    const current = this.cases.get(c.id);
    if (!current || current.tenantId !== c.tenantId || current.version !== expectedVersion) return false;
    for (const row of [...events, ...jobs, ...[handoff, assessment].filter(Boolean)] as Array<{tenantId: string; caseId: string | null}>) {
      if (row.tenantId !== c.tenantId || row.caseId !== c.id) throw new Error("case commit scope mismatch");
    }
    if (handoff && this.handoffs.some(h => h.caseId === c.id && h.version === handoff.version)) throw new Error("duplicate handoff");
    this.cases.set(c.id, c);
    this.events.push(...events);
    this.jobs.push(...jobs);
    if (handoff) this.handoffs.push(handoff);
    if (assessment) this.assessments.set(`${c.tenantId}:${c.id}`, assessment);
    return true;
  }
  async listJobs(tenantId: string) { return structuredClone(this.jobs.filter(j => j.tenantId === tenantId)); }
  async retryJob(tenantId: string, id: string) {
    const j = this.jobs.find(j => j.id === id && j.tenantId === tenantId);
    if (!j || j.status !== "failed" || (j.operatorRetries ?? 0) >= 3) return false;
    j.operatorRetries = (j.operatorRetries ?? 0) + 1;
    j.attempts = 0; j.status = "pending"; j.leaseUntil = null; j.availableAt = new Date().toISOString();
    return true;
  }
  async updateJobPayload(tenantId: string, id: string, payload: Record<string, unknown>) {
    const j = this.jobs.find(j => j.id === id && j.tenantId === tenantId);
    if (j) j.payload = structuredClone(payload);
  }

  async purgeExpired(tenant: TenantConfig, now: string) {
    const cutoff = (days: number) => Date.parse(now)-days*86400000;
    let count=0;
    for (const c of [...this.cases.values()]) {
      if(c.tenantId!==tenant.id)continue;
      const expired=(c.workflowStatus==="draft" && !c.submittedAt && Date.parse(c.updatedAt)<cutoff(tenant.retention.draftDays)) ||
        (["closed","cancelled"].includes(c.workflowStatus) && Date.parse(c.updatedAt)<cutoff(tenant.retention.closedDays));
      if(!expired || this.jobs.some(j=>j.caseId===c.id && ["pending","leased"].includes(j.status)))continue;
      const keys=this.attachments.filter(a=>a.caseId===c.id&&a.tenantId===tenant.id).map(a=>a.storageKey);
      this.jobs.push({id:randomUUID(),tenantId:tenant.id,caseId:null,kind:"storage_delete",payload:{keys},status:"pending",attempts:0,maxAttempts:8,leaseUntil:null,lastError:null,createdAt:now,updatedAt:now});
      this.cases.delete(c.id);this.assessments.delete(`${tenant.id}:${c.id}`);this.outcomes.delete(`${tenant.id}:${c.id}`);
      for(const name of ["messages","facts","attachments","handoffs","events","jobs"] as const) {
        // All entries for this globally unique case are relational dependants.
        (this[name] as Array<{caseId:string|null}>) = this[name].filter(row=>row.caseId!==c.id);
      }
      for(const [id,session] of this.sessions)if(session.tenantId===tenant.id&&session.caseId===c.id)this.sessions.delete(id);
      count++;
    }
    for(const [id,s]of this.sessions)if(s.tenantId===tenant.id&&s.expiresAt<=now)this.sessions.delete(id);
    for(const [id,s]of this.staffSessions)if(s.tenantId===tenant.id&&s.expiresAt<=now)this.staffSessions.delete(id);
    return count;
  }

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
  async consumeBootstrap(hash: string, now: string) {
    for (const s of this.sessions.values()) {
      if (s.bootstrapCodeHash !== hash) continue;
      if (s.bootstrapUsed || s.expiresAt < now) return null;
      s.bootstrapUsed = true;
      s.bootstrapCodeHash = null;
      return structuredClone(s);
    }
    return null;
  }

  async clearAssessment(tenantId: string, caseId: string) { this.assessments.delete(`${tenantId}:${caseId}`); }
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

  async saveDocument(d: KnowledgeDocument) { if (!this.documents.has(d.id)) this.documents.set(d.id, structuredClone(d)); }
  async saveChunk(c: KnowledgeChunk) { if (!this.chunks.has(c.id)) this.chunks.set(c.id, structuredClone(c)); }
  async listDocuments(tenantId: string) {
    return [...this.documents.values()].filter((d) => d.visibility === "shared" || d.tenantId === tenantId).map((d) => structuredClone(d));
  }
  async listChunks(tenantId: string) {
    return [...this.chunks.values()].filter((c) => c.visibility === "shared" || c.tenantId === tenantId).map((c) => structuredClone(c));
  }


  async enqueueJob(j: JobRecord) { this.jobs.push(structuredClone(j)); }
  async leaseJob(now: string) {
    for (const j of this.jobs) {
      if (j.attempts >= j.maxAttempts && (j.status === "pending" || (j.status === "leased" && j.leaseUntil! <= now))) j.status = "failed";
    }
    const ordered = this.jobs;
    const job = ordered.find((j, i) =>
      (j.availableAt ?? j.createdAt) <= now && j.attempts < j.maxAttempts &&
      (j.status === "pending" || (j.status === "leased" && j.leaseUntil !== null && j.leaseUntil <= now)) &&
      !ordered.slice(0,i).some(older => j.caseId !== null && older.caseId === j.caseId && older.tenantId === j.tenantId && (older.kind === j.kind || (["turn","label"].includes(older.kind) && ["turn","label"].includes(j.kind))) && ["pending", "leased", "failed"].includes(older.status)));
    if (!job) return null;
    job.status = "leased";
    job.attempts += 1;
    job.leaseVersion = (job.leaseVersion ?? 0) + 1;
    job.leaseUntil = new Date(Date.parse(now) + 120000).toISOString();
    job.updatedAt = now;
    return structuredClone(job);
  }
  async olderTurnJobPending(caseId: string, beforeCreatedAt: string, excludeId: string) {
    return this.jobs.some((j) => j.caseId === caseId && j.kind === "turn" && j.id !== excludeId &&
      (j.status === "pending" || j.status === "leased") && j.createdAt < beforeCreatedAt);
  }
  async completeJob(id: string, attempt?: number) {
    const j = this.jobs.find((x) => x.id === id);
    if (j && (attempt === undefined || (j.status === "leased" && j.leaseVersion === attempt))) { if(j.kind === "storage_delete") j.payload = {}; j.status = "done"; j.updatedAt = new Date().toISOString(); }
  }
  async failJob(id: string, error: string, retryAt: string | null, attempt?: number) {
    const j = this.jobs.find((x) => x.id === id);
    if (!j || (attempt !== undefined && (j.status !== "leased" || j.leaseVersion !== attempt))) return;
    j.lastError = error;
    j.updatedAt = new Date().toISOString();
    if (retryAt && j.attempts < j.maxAttempts) { j.status = "pending"; j.leaseUntil = null; j.availableAt = retryAt; }
    else j.status = "failed";
  }
  async idempotencyGet(tenantId: string, key: string) { return this.idem.get(`${tenantId}:${key}`) ?? null; }
  async idempotencyPut(tenantId: string, key: string, responseHash: string) { this.idem.set(`${tenantId}:${key}`, responseHash); }

  async saveEndpoint(e: WebhookEndpoint) { this.endpoints.set(e.id, structuredClone(e)); }
  async listEndpoints(tenantId: string) {
    return [...this.endpoints.values()].filter((e) => e.tenantId === tenantId).map((e) => structuredClone(e));
  }
  async saveDelivery(d: WebhookDelivery) {
    const i = this.deliveries.findIndex(x => x.tenantId === d.tenantId && x.endpointId === d.endpointId && x.eventId === d.eventId);
    if (i < 0) this.deliveries.push(structuredClone(d)); else this.deliveries[i] = structuredClone(d);
  }
  async listDeliveries(tenantId: string, eventId?: string) {
    return this.deliveries.filter((d) => d.tenantId === tenantId && (!eventId || d.eventId === eventId)).map((d) => structuredClone(d));
  }

  async saveStaffUser(u: StaffUser) { this.staff.set(u.id, structuredClone(u)); }
  async getStaffByEmail(tenantId: string, email: string) {
    for (const u of this.staff.values()) {
      if (u.tenantId === tenantId && u.email.toLowerCase() === email.toLowerCase()) return structuredClone(u);
    }
    return null;
  }
  async getStaffById(tenantId: string, id: string) {
    const u = this.staff.get(id);
    if (!u || u.tenantId !== tenantId) return null;
    return structuredClone(u);
  }
  async createStaffSession(s: StaffSession) { this.staffSessions.set(s.id, structuredClone(s)); }
  async getStaffSession(id: string) { return structuredClone(this.staffSessions.get(id) ?? null); }
  async saveServiceCredential(c: ServiceCredential) { this.svcCreds.set(c.id, structuredClone(c)); }
  async getServiceCredentialByHash(hash: string) {
    for (const c of this.svcCreds.values()) if (c.keyHash === hash) return structuredClone(c);
    return null;
  }
  async listServiceCredentials(tenantId: string) {
    return [...this.svcCreds.values()]
      .filter((c) => c.tenantId === tenantId)
      .map((c) => ({ name: c.name, scopes: [...c.scopes], createdAt: c.createdAt }));
  }
  async saveOutcome(o: OutcomeRecord) { this.outcomes.set(`${o.tenantId}:${o.caseId}`, structuredClone(o)); }
  async getOutcome(tenantId: string, caseId: string) {
    return structuredClone(this.outcomes.get(`${tenantId}:${caseId}`) ?? null);
  }
}
