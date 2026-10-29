// Postgres store. Sets app.tenant_id per transaction for RLS defense-in-depth;
// application code still scopes every query by tenant_id explicitly.
// Auth/session/worker bootstrap operations go through the narrow SECURITY
// DEFINER functions from migration 004 — the only pre-tenant-context paths.
export interface PgPoolLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  connect(): Promise<{
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    release(): void;
  }>;
}
import type { Assessment, Attachment, CaseEvent, CaseFact, CaseRecord, Handoff, Message, TenantConfig } from "../domain/types.js";
import type { KnowledgeChunk, KnowledgeDocument } from "../domain/knowledge.js";
import type { JobRecord, OutcomeRecord, ServiceCredential, SessionRecord, StaffSession, StaffUser, Store, WebhookDelivery, WebhookEndpoint } from "./store.js";

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

export class PgStore implements Store {
  constructor(private pool: PgPoolLike) {}

  private async tenant<T>(tenantId: string, fn: (q: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const q = async (text: string, params: unknown[] = []) => client.query(text, params as never[]);
      const out = await fn(q as never);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }
  }

  private async query(text: string, params: unknown[] = []) {
    return this.pool.query(text, params as never[]);
  }

  async getTenant(id: string): Promise<TenantConfig | null> {
    const r = await this.query("SELECT config FROM tenants WHERE id=$1", [id]);
    return (r.rows[0]?.config as TenantConfig) ?? null;
  }
  async getTenantBySlug(slug: string) {
    const r = await this.query("SELECT config FROM tenants WHERE slug=$1", [slug]);
    return (r.rows[0]?.config as TenantConfig) ?? null;
  }
  async getTenantByPublicKey(key: string) {
    const r = await this.query("SELECT config FROM tenants WHERE public_key=$1", [key]);
    return (r.rows[0]?.config as TenantConfig) ?? null;
  }
  async listTenants() {
    const r = await this.query("SELECT config FROM tenants ORDER BY slug");
    return r.rows.map((x) => x.config as TenantConfig);
  }
  async saveTenant(t: TenantConfig) {
    await this.query(
      "INSERT INTO tenants(id, slug, public_key, config) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug, public_key=EXCLUDED.public_key, config=EXCLUDED.config",
      [t.id, t.slug, t.publicKey, JSON.stringify(t)]
    );
  }

  private caseFrom(r: Record<string, unknown>): CaseRecord {
    return {
      id: String(r.id), tenantId: String(r.tenant_id), reference: String(r.reference),
      source: r.source as CaseRecord["source"], conversationPhase: r.conversation_phase as CaseRecord["conversationPhase"],
      workflowStatus: r.workflow_status as CaseRecord["workflowStatus"], safetyStatus: r.safety_status as CaseRecord["safetyStatus"],
      disposition: r.disposition as CaseRecord["disposition"],
      pendingAction: (r.pending_action as CaseRecord["pendingAction"]) ?? null,
      version: Number(r.version),
      externalReference: (r.external_reference as string) ?? null,
      diagnosticQuestionsAsked: Number(r.diagnostic_questions_asked ?? 0),
      modelMode: (r.model_mode as CaseRecord["modelMode"]) ?? "fixture",
      createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
      submittedAt: r.submitted_at ? iso(r.submitted_at) : null,
    };
  }

  async createCase(c: CaseRecord) {
    await this.tenant(c.tenantId, async (q) => {
      await q("INSERT INTO cases(id, tenant_id, reference, source, conversation_phase, workflow_status, safety_status, disposition, version, external_reference, diagnostic_questions_asked, model_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [c.id, c.tenantId, c.reference, c.source, c.conversationPhase, c.workflowStatus, c.safetyStatus, c.disposition, c.version, c.externalReference, c.diagnosticQuestionsAsked, c.modelMode]);
    });
  }
  async getCase(tenantId: string, caseId: string) {
    return this.tenant(tenantId, async (q) => {
      const r = await q("SELECT * FROM cases WHERE tenant_id=$1 AND id=$2", [tenantId, caseId]);
      return r.rows[0] ? this.caseFrom(r.rows[0]) : null;
    });
  }
  async updateCase(c: CaseRecord) {
    await this.tenant(c.tenantId, async (q) => {
      await q("UPDATE cases SET conversation_phase=$1, workflow_status=$2, safety_status=$3, disposition=$4, version=$5, external_reference=$6, diagnostic_questions_asked=$7, model_mode=$8, updated_at=now(), submitted_at=$9, pending_action=$10 WHERE tenant_id=$11 AND id=$12",
        [c.conversationPhase, c.workflowStatus, c.safetyStatus, c.disposition, c.version, c.externalReference, c.diagnosticQuestionsAsked, c.modelMode, c.submittedAt, c.pendingAction ? JSON.stringify(c.pendingAction) : null, c.tenantId, c.id]);
    });
  }
  async listCases(tenantId: string) {
    return this.tenant(tenantId, async (q) => {
      const r = await q("SELECT * FROM cases WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200", [tenantId]);
      return r.rows.map((x) => this.caseFrom(x));
    });
  }

  async addMessage(m: Message) {
    await this.tenant(m.tenantId, async (q) => {
      await q("INSERT INTO messages(id, tenant_id, case_id, role, body) VALUES($1,$2,$3,$4,$5)", [m.id, m.tenantId, m.caseId, m.role, m.body]);
    });
  }
  async listMessages(tenantId: string, caseId: string) {
    return this.tenant(tenantId, async (q) => {
      const r = await q("SELECT * FROM messages WHERE tenant_id=$1 AND case_id=$2 ORDER BY created_at ASC", [tenantId, caseId]);
      return r.rows.map((x) => ({ id: String(x.id), tenantId: String(x.tenant_id), caseId: String(x.case_id), role: x.role as Message["role"], body: String(x.body), createdAt: iso(x.created_at) }));
    });
  }
  async addFact(f: CaseFact) {
    await this.tenant(f.tenantId, async (q) => {
      await q("INSERT INTO case_facts(id, tenant_id, case_id, key, value, status, source_message_id, source_attachment_id, certainty, supersedes_id, confirmed_by, confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [f.id, f.tenantId, f.caseId, f.key, JSON.stringify(f.value), f.status, f.sourceMessageId, f.sourceAttachmentId, f.certainty, f.supersedesId, f.confirmedBy, f.confirmedAt]);
    });
  }
  async listFacts(tenantId: string, caseId: string) {
    return this.tenant(tenantId, async (q) => {
      const r = await q("SELECT * FROM case_facts WHERE tenant_id=$1 AND case_id=$2 ORDER BY created_at ASC", [tenantId, caseId]);
      return r.rows.map((x) => ({
        id: String(x.id), tenantId: String(x.tenant_id), caseId: String(x.case_id), key: String(x.key),
        value: (x.value as { valueOf?: () => unknown })?.valueOf ? JSON.parse(JSON.stringify(x.value)) as CaseFact["value"] : (x.value as CaseFact["value"]),
        status: x.status as CaseFact["status"],
        sourceMessageId: x.source_message_id ? String(x.source_message_id) : null,
        sourceAttachmentId: x.source_attachment_id ? String(x.source_attachment_id) : null,
        certainty: x.certainty as CaseFact["certainty"], createdAt: iso(x.created_at),
        supersedesId: x.supersedes_id ? String(x.supersedes_id) : null,
        confirmedBy: x.confirmed_by ? String(x.confirmed_by) : null,
        confirmedAt: x.confirmed_at ? iso(x.confirmed_at) : null,
      }));
    });
  }
  async markFactSuperseded(tenantId: string, factId: string) {
    await this.tenant(tenantId, async (q) => {
      await q("UPDATE case_facts SET status='superseded' WHERE tenant_id=$1 AND id=$2", [tenantId, factId]);
    });
  }
  async addAttachment(a: Attachment) {
    await this.tenant(a.tenantId, async (q) => {
      await q("INSERT INTO attachments(id, tenant_id, case_id, kind, mime_type, size_bytes, storage_key, sha256, raw_ocr_text) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [a.id, a.tenantId, a.caseId, a.kind, a.mimeType, a.sizeBytes, a.storageKey, a.sha256, a.rawOcrText]);
    });
  }
  async listAttachments(tenantId: string, caseId: string) {
    return this.tenant(tenantId, async (q) => {
      const r = await q("SELECT * FROM attachments WHERE tenant_id=$1 AND case_id=$2 ORDER BY created_at ASC", [tenantId, caseId]);
      return r.rows.map((x) => ({ id: String(x.id), tenantId: String(x.tenant_id), caseId: String(x.case_id), kind: x.kind as Attachment["kind"], mimeType: String(x.mime_type), sizeBytes: Number(x.size_bytes), storageKey: String(x.storage_key), sha256: String(x.sha256), rawOcrText: x.raw_ocr_text ? String(x.raw_ocr_text) : null, createdAt: iso(x.created_at) }));
    });
  }
  async updateAttachmentOcr(tenantId: string, attachmentId: string, rawText: string) {
    await this.tenant(tenantId, async (q) => {
      await q("UPDATE attachments SET raw_ocr_text=$1 WHERE tenant_id=$2 AND id=$3", [rawText, tenantId, attachmentId]);
    });
  }
  async countAttachments(tenantId: string, caseId: string) {
    return this.tenant(tenantId, async (q) => {
      const r = await q("SELECT COUNT(*)::int AS n FROM attachments WHERE tenant_id=$1 AND case_id=$2", [tenantId, caseId]);
      return Number(r.rows[0].n);
    });
  }

  async createSession(s: SessionRecord) {
    await this.tenant(s.tenantId, async (q) => {
      await q("INSERT INTO customer_sessions(id, tenant_id, case_id, token_hash, bootstrap_code_hash, bootstrap_used, expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [s.id, s.tenantId, s.caseId, s.tokenHash, s.bootstrapCodeHash, s.bootstrapUsed, s.expiresAt]);
    });
  }
  async getSessionByTokenHash(hash: string) {
    const r = await this.query("SELECT * FROM auth_session_by_token($1)", [hash]);
    const x = r.rows[0] as Record<string, unknown> | undefined;
    return x ? { id: String(x.id), tenantId: String(x.tenant_id), caseId: String(x.case_id), tokenHash: String(x.token_hash), bootstrapCodeHash: x.bootstrap_code_hash ? String(x.bootstrap_code_hash) : null, bootstrapUsed: Boolean(x.bootstrap_used), createdAt: iso(x.created_at), expiresAt: iso(x.expires_at) } : null;
  }
  async consumeBootstrap(hash: string, now: string) {
    const r = await this.query("SELECT * FROM auth_consume_bootstrap($1, $2::timestamptz)", [hash, now]);
    const x = r.rows[0] as Record<string, unknown> | undefined;
    return x ? { id: String(x.id), tenantId: String(x.tenant_id), caseId: String(x.case_id), tokenHash: String(x.token_hash), bootstrapCodeHash: null, bootstrapUsed: true, createdAt: iso(x.created_at), expiresAt: iso(x.expires_at) } : null;
  }

  async saveAssessment(a: Assessment) {
    await this.tenant(a.tenantId, async (q) => {
      await q("INSERT INTO assessments(id, tenant_id, case_id, status, hypotheses, recommended_follow_up, knowledge_level, citations) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id, case_id) DO UPDATE SET status=EXCLUDED.status, hypotheses=EXCLUDED.hypotheses, recommended_follow_up=EXCLUDED.recommended_follow_up, knowledge_level=EXCLUDED.knowledge_level, citations=EXCLUDED.citations",
        [a.id, a.tenantId, a.caseId, a.status, JSON.stringify(a.hypotheses), a.recommendedFollowUp, a.knowledgeLevel, JSON.stringify(a.citations)]);
    });
  }
  async getAssessment(tenantId: string, caseId: string) {
    return this.tenant(tenantId, async (q) => {
      const r = await q("SELECT * FROM assessments WHERE tenant_id=$1 AND case_id=$2", [tenantId, caseId]);
      const x = r.rows[0];
      return x ? { id: String(x.id), tenantId: String(x.tenant_id), caseId: String(x.case_id), status: x.status as Assessment["status"], hypotheses: x.hypotheses as Assessment["hypotheses"], recommendedFollowUp: String(x.recommended_follow_up), knowledgeLevel: x.knowledge_level as Assessment["knowledgeLevel"], citations: x.citations as Assessment["citations"], createdAt: iso(x.created_at) } : null;
    });
  }
  async saveHandoff(h: Handoff) {
    await this.tenant(h.tenantId, async (q) => {
      await q("INSERT INTO handoff_versions(case_id, version, tenant_id, snapshot) VALUES($1,$2,$3,$4)", [h.caseId, h.version, h.tenantId, JSON.stringify(h.snapshot)]);
    });
  }
  async listHandoffs(tenantId: string, caseId: string) {
    return this.tenant(tenantId, async (q) => {
      const r = await q("SELECT * FROM handoff_versions WHERE tenant_id=$1 AND case_id=$2 ORDER BY version ASC", [tenantId, caseId]);
      return r.rows.map((x) => ({ version: Number(x.version), caseId: String(x.case_id), tenantId: String(x.tenant_id), createdAt: iso(x.created_at), snapshot: x.snapshot as Record<string, unknown> }));
    });
  }
  async addEvent(e: CaseEvent) {
    await this.tenant(e.tenantId, async (q) => {
      await q("INSERT INTO case_events(id, tenant_id, case_id, type, payload) VALUES($1,$2,$3,$4,$5)", [e.id, e.tenantId, e.caseId, e.type, JSON.stringify(e.payload)]);
    });
  }
  async listEvents(tenantId: string, caseId: string) {
    return this.tenant(tenantId, async (q) => {
      const r = await q("SELECT * FROM case_events WHERE tenant_id=$1 AND case_id=$2 ORDER BY created_at ASC", [tenantId, caseId]);
      return r.rows.map((x) => ({ id: String(x.id), tenantId: String(x.tenant_id), caseId: String(x.case_id), type: String(x.type), payload: x.payload as Record<string, unknown>, createdAt: iso(x.created_at) }));
    });
  }

  async saveDocument(d: KnowledgeDocument) {
    await this.tenant(d.tenantId ?? "", async (q) => {
      await q("INSERT INTO knowledge_documents(id, tenant_id, visibility, publisher, source_url, document_type, title, language, brand, explicit_models, explicit_families, hash, version, review_status, reviewed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(id) DO NOTHING",
        [d.id, d.tenantId, d.visibility, d.publisher, d.sourceUrl, d.documentType, d.title, d.language, d.brand, JSON.stringify(d.explicitModels), JSON.stringify(d.explicitFamilies), d.hash, d.version, d.reviewStatus, d.reviewedBy]);
    });
  }
  async saveChunk(c: KnowledgeChunk) {
    await this.tenant(c.tenantId ?? "", async (q) => {
      await q("INSERT INTO knowledge_chunks(id, document_id, tenant_id, visibility, version, page_index, page_label, text, applicability) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING",
        [c.id, c.documentId, c.tenantId, c.visibility, c.version, c.pageIndex, c.pageLabel, c.text, JSON.stringify(c.applicability)]);
    });
  }
  async listDocuments(tenantId: string) {
    return this.tenant(tenantId, async (q) => {
      const r = await q("SELECT * FROM knowledge_documents WHERE visibility='shared' OR tenant_id=$1", [tenantId]);
      return r.rows.map((x) => this.docFrom(x as Record<string, unknown>));
    });
  }
  async listChunks(tenantId: string) {
    return this.tenant(tenantId, async (q) => {
      const r = await q("SELECT * FROM knowledge_chunks WHERE visibility='shared' OR tenant_id=$1", [tenantId]);
      return r.rows.map((x) => ({ id: String(x.id), documentId: String(x.document_id), tenantId: x.tenant_id ? String(x.tenant_id) : null, visibility: x.visibility as KnowledgeChunk["visibility"], version: String(x.version), pageIndex: Number(x.page_index), pageLabel: x.page_label ? String(x.page_label) : null, text: String(x.text), applicability: x.applicability as KnowledgeChunk["applicability"] }));
    });
  }
  private docFrom(x: Record<string, unknown>): KnowledgeDocument {
    return { id: String(x.id), tenantId: x.tenant_id ? String(x.tenant_id) : null, visibility: x.visibility as KnowledgeDocument["visibility"], publisher: String(x.publisher), sourceUrl: x.source_url ? String(x.source_url) : null, documentType: String(x.document_type), title: String(x.title), language: String(x.language), brand: x.brand ? String(x.brand) : null, explicitModels: (x.explicit_models as string[]) ?? [], explicitFamilies: (x.explicit_families as string[]) ?? [], retrievedAt: iso(x.retrieved_at), hash: String(x.hash), version: String(x.version), reviewStatus: x.review_status as KnowledgeDocument["reviewStatus"], reviewedBy: x.reviewed_by ? String(x.reviewed_by) : null };
  }

  async enqueueJob(j: JobRecord) {
    await this.tenant(j.tenantId, async (q) => {
      await q("INSERT INTO background_jobs(id, tenant_id, case_id, kind, payload, status, attempts, max_attempts, lease_until, last_error) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [j.id, j.tenantId, j.caseId, j.kind, JSON.stringify(j.payload), j.status, j.attempts, j.maxAttempts, j.leaseUntil, j.lastError]);
    });
  }
  async leaseJob(now: string) {
    const r = await this.query("SELECT * FROM worker_lease_job($1::timestamptz)", [now]);
    const x = r.rows[0] as Record<string, unknown> | undefined;
    return x ? this.jobFrom(x) : null;
  }
  async olderTurnJobPending(caseId: string, beforeCreatedAt: string, excludeId: string) {
    const r = await this.query("SELECT worker_older_turn_pending($1, $2::timestamptz, $3) AS pending", [caseId, beforeCreatedAt, excludeId]);
    return r.rows[0]?.pending === true;
  }
  async completeJob(id: string) {
    await this.query("SELECT worker_complete_job($1)", [id]);
  }
  async failJob(id: string, error: string, retryAt: string | null) {
    await this.query("SELECT worker_fail_job($1, $2, $3)", [id, error, retryAt !== null]);
  }

  private jobFrom(x: Record<string, unknown>): JobRecord {
    return { id: String(x.id), tenantId: String(x.tenant_id), caseId: x.case_id ? String(x.case_id) : null, kind: String(x.kind), payload: (x.payload as Record<string, unknown>) ?? {}, status: x.status as JobRecord["status"], attempts: Number(x.attempts), maxAttempts: Number(x.max_attempts), leaseUntil: x.lease_until ? iso(x.lease_until) : null, lastError: x.last_error ? String(x.last_error) : null, createdAt: iso(x.created_at), updatedAt: iso(x.updated_at) };
  }

  async idempotencyGet(tenantId: string, key: string) {
    return this.tenant(tenantId, async (q) => {
      const r = await q("SELECT response_hash FROM idempotency WHERE tenant_id=$1 AND key=$2", [tenantId, key]);
      return r.rows[0] ? String(r.rows[0].response_hash) : null;
    });
  }
  async idempotencyPut(tenantId: string, key: string, responseHash: string) {
    await this.tenant(tenantId, async (q) => {
      await q("INSERT INTO idempotency(tenant_id, key, response_hash) VALUES($1,$2,$3) ON CONFLICT(tenant_id, key) DO NOTHING", [tenantId, key, responseHash]);
    });
  }

  async saveEndpoint(e: WebhookEndpoint) {
    await this.tenant(e.tenantId, async (q) => {
      await q("INSERT INTO webhook_endpoints(id, tenant_id, url, secret, events, active) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET url=EXCLUDED.url, secret=EXCLUDED.secret, events=EXCLUDED.events, active=EXCLUDED.active",
        [e.id, e.tenantId, e.url, e.secret, JSON.stringify(e.events), e.active]);
    });
  }
  async listEndpoints(tenantId: string) {
    return this.tenant(tenantId, async (q) => {
      const r = await q("SELECT * FROM webhook_endpoints WHERE tenant_id=$1", [tenantId]);
      return r.rows.map((x) => ({ id: String(x.id), tenantId: String(x.tenant_id), url: String(x.url), secret: String(x.secret), events: (x.events as string[]) ?? [], active: Boolean(x.active) }));
    });
  }
  async saveDelivery(d: WebhookDelivery) {
    await this.tenant(d.tenantId, async (q) => {
      await q("INSERT INTO webhook_deliveries(id, tenant_id, endpoint_id, event_id, event_type, status, attempts, last_error) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [d.id, d.tenantId, d.endpointId, d.eventId, d.eventType, d.status, d.attempts, d.lastError]);
    });
  }
  async listDeliveries(tenantId: string) {
    return this.tenant(tenantId, async (q) => {
      const r = await q("SELECT * FROM webhook_deliveries WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100", [tenantId]);
      return r.rows.map((x) => ({ id: String(x.id), tenantId: String(x.tenant_id), endpointId: String(x.endpoint_id), eventId: String(x.event_id), eventType: String(x.event_type), status: String(x.status), attempts: Number(x.attempts), lastError: x.last_error ? String(x.last_error) : null, createdAt: iso(x.created_at) }));
    });
  }

  async saveStaffUser(u: StaffUser) {
    await this.tenant(u.tenantId, async (q) => {
      await q("INSERT INTO staff_users(id, tenant_id, email, password_hash, role, name) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id, email) DO UPDATE SET password_hash=EXCLUDED.password_hash, role=EXCLUDED.role, name=EXCLUDED.name",
        [u.id, u.tenantId, u.email, u.passwordHash, u.role, u.name]);
    });
  }
  async getStaffByEmail(tenantId: string, email: string) {
    return this.tenant(tenantId, async (q) => {
      const r = await q("SELECT * FROM staff_users WHERE tenant_id=$1 AND lower(email)=lower($2)", [tenantId, email]);
      const x = r.rows[0];
      return x ? { id: String(x.id), tenantId: String(x.tenant_id), email: String(x.email), passwordHash: String(x.password_hash), role: x.role as StaffUser["role"], name: String(x.name) } : null;
    });
  }
  async getStaffById(tenantId: string, id: string) {
    return this.tenant(tenantId, async (q) => {
      const r = await q("SELECT * FROM staff_users WHERE tenant_id=$1 AND id=$2", [tenantId, id]);
      const x = r.rows[0];
      return x ? { id: String(x.id), tenantId: String(x.tenant_id), email: String(x.email), passwordHash: String(x.password_hash), role: x.role as StaffUser["role"], name: String(x.name) } : null;
    });
  }
  async createStaffSession(s: StaffSession) {
    await this.tenant(s.tenantId, async (q) => {
      await q("INSERT INTO staff_sessions(id, user_id, tenant_id, expires_at) VALUES($1,$2,$3,$4)", [s.id, s.userId, s.tenantId, s.expiresAt]);
    });
  }
  async getStaffSession(id: string) {
    const r = await this.query("SELECT * FROM auth_staff_session($1)", [id]);
    const x = r.rows[0] as Record<string, unknown> | undefined;
    return x ? { id: String(x.id), userId: String(x.user_id), tenantId: String(x.tenant_id), createdAt: iso(x.created_at), expiresAt: iso(x.expires_at) } : null;
  }
  async saveServiceCredential(c: ServiceCredential) {
    await this.tenant(c.tenantId, async (q) => {
      await q("INSERT INTO service_credentials(id, tenant_id, name, key_hash, scopes) VALUES($1,$2,$3,$4,$5)", [c.id, c.tenantId, c.name, c.keyHash, JSON.stringify(c.scopes)]);
    });
  }
  async getServiceCredentialByHash(hash: string) {
    const r = await this.query("SELECT * FROM auth_service_key($1)", [hash]);
    const x = r.rows[0] as Record<string, unknown> | undefined;
    return x ? { id: String(x.id), tenantId: String(x.tenant_id), name: String(x.name), keyHash: String(x.key_hash), scopes: (x.scopes as string[]) ?? [], createdAt: iso(x.created_at) } : null;
  }
  async listServiceCredentials(tenantId: string) {
    return this.tenant(tenantId, async (q) => {
      const r = await q("SELECT name, scopes, created_at FROM service_credentials WHERE tenant_id=$1", [tenantId]);
      return r.rows.map((x) => ({ name: String(x.name), scopes: (x.scopes as string[]) ?? [], createdAt: iso(x.created_at) }));
    });
  }
  async saveOutcome(o: OutcomeRecord) {
    await this.tenant(o.tenantId, async (q) => {
      await q("INSERT INTO repair_outcomes(case_id, tenant_id, rating, confirmed_issue, hypotheses_useful, recorded_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id, case_id) DO UPDATE SET rating=EXCLUDED.rating, confirmed_issue=EXCLUDED.confirmed_issue, hypotheses_useful=EXCLUDED.hypotheses_useful, recorded_by=EXCLUDED.recorded_by, recorded_at=now()",
        [o.caseId, o.tenantId, o.rating, o.confirmedIssue, o.hypothesesUseful, o.recordedBy]);
    });
  }
  async getOutcome(tenantId: string, caseId: string) {
    return this.tenant(tenantId, async (q) => {
      const r = await q("SELECT * FROM repair_outcomes WHERE tenant_id=$1 AND case_id=$2", [tenantId, caseId]);
      const x = r.rows[0];
      return x ? { caseId: String(x.case_id), tenantId: String(x.tenant_id), rating: String(x.rating), confirmedIssue: x.confirmed_issue ? String(x.confirmed_issue) : null, hypothesesUseful: x.hypotheses_useful as boolean | null, recordedBy: x.recorded_by ? String(x.recorded_by) : "", recordedAt: iso(x.recorded_at) } : null;
    });
  }
}
