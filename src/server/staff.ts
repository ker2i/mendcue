// Staff dashboard API: cookie sessions, CSRF, role checks, all tenant-scoped.
import express from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { AppDeps } from "./app.js";
import { errorBody } from "../domain/types.js";
import { csrfToken, rateLimit, requestId, verifyPassword } from "./auth.js";

const COOKIE = "staff_session";
const CSRF_COOKIE = "staff_csrf";

export function registerStaffRoutes(app: express.Express, deps: AppDeps): void {
  app.post("/api/v1/staff/login", async (req, res) => {
    const rid = requestId();
    const schema = z.object({ tenantSlug: z.string().min(1), email: z.string().email(), password: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(errorBody("VALIDATION_ERROR", "tenantSlug, email, password required.", rid));
    const ip = String(req.ip ?? "unknown");
    if (!rateLimit(`login:${ip}`, 10, 60_000)) {
      return res.status(429).json(errorBody("RATE_LIMITED", "Too many login attempts.", rid));
    }
    const tenant = await deps.store.getTenantBySlug(parsed.data.tenantSlug);
    if (!tenant) return res.status(401).json(errorBody("UNAUTHORIZED", "Invalid login.", rid));
    const user = await deps.store.getStaffByEmail(tenant.id, parsed.data.email);
    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      return res.status(401).json(errorBody("UNAUTHORIZED", "Invalid login.", rid));
    }
    const sid = randomUUID();
    const now = new Date().toISOString();
    await deps.store.createStaffSession({
      id: sid, userId: user.id, tenantId: tenant.id, createdAt: now,
      expiresAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
    });
    const csrf = csrfToken();
    res.cookie(COOKIE, sid, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 3600_000, path: "/" });
    res.cookie(CSRF_COOKIE, csrf, { httpOnly: false, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 3600_000, path: "/" });
    res.json({ ok: true, user: { name: user.name, role: user.role, email: user.email }, csrf, tenant: tenant.slug });
  });

  async function staffAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const rid = requestId();
    const sid = String(req.cookies?.[COOKIE] ?? "");
    if (!sid) return res.status(401).json(errorBody("UNAUTHORIZED", "Staff login required.", rid));
    const s = await deps.store.getStaffSession(sid);
    if (!s || s.expiresAt < new Date().toISOString()) {
      return res.status(401).json(errorBody("UNAUTHORIZED", "Session expired.", rid));
    }
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
      const header = String(req.headers["x-csrf-token"] ?? "");
      const cookie = String(req.cookies?.[CSRF_COOKIE] ?? "");
      if (!header || !cookie || header !== cookie) {
        return res.status(403).json(errorBody("FORBIDDEN", "CSRF check failed.", rid));
      }
    }
    const tenant = await deps.store.getTenant(s.tenantId);
    if (!tenant) return res.status(401).json(errorBody("UNAUTHORIZED", "Unknown tenant.", rid));
    // Revalidate membership and role on every request.
    const user = await deps.store.getStaffById(s.tenantId, s.userId);
    if (!user) return res.status(401).json(errorBody("UNAUTHORIZED", "Unknown staff user.", rid));
    (req as unknown as { staffTenant: typeof tenant; staffSession: typeof s; staffUser: typeof user }).staffTenant = tenant;
    (req as unknown as { staffSession: typeof s }).staffSession = s;
    (req as unknown as { staffUser: typeof user }).staffUser = user;
    next();
  }

  const ctx = (req: express.Request) =>
    req as unknown as { staffTenant: { id: string; slug: string }; staffSession: { userId: string }; staffUser: { role: string } };

  // Server-enforced permission matrix: read-only staff may read but never
  // mutate cases or outcomes. Technician, dispatcher, and owner may mutate.
  function requireMutate(req: express.Request, res: express.Response, next: express.NextFunction) {
    const { staffUser } = ctx(req);
    if (staffUser.role === "readonly") {
      return res.status(403).json(errorBody("FORBIDDEN", "Read-only role cannot modify cases.", requestId()));
    }
    next();
  }

  app.get("/api/v1/staff/cases", staffAuth, async (req, res) => {
    const { staffTenant } = ctx(req);
    const cases = await deps.store.listCases(staffTenant.id);
    const rows = [];
    for (const c of cases) {
      const facts = await deps.store.listFacts(staffTenant.id, c.id);
      const byKey = new Map(facts.filter((f) => f.status !== "superseded").map((f) => [f.key, f.value]));
      rows.push({
        id: c.id, reference: c.reference, source: c.source,
        appliance: byKey.get("appliance_category") ?? null,
        complaint: byKey.get("problem_description") ?? null,
        zip: byKey.get("service_zip") ?? null,
        safetyStatus: c.safetyStatus, workflowStatus: c.workflowStatus,
        disposition: c.disposition, submittedAt: c.submittedAt, version: c.version,
      });
    }
    rows.sort((a, b) => String(b.submittedAt ?? "").localeCompare(String(a.submittedAt ?? "")));
    res.json({ cases: rows });
  });

  app.get("/api/v1/staff/cases/:caseId", staffAuth, async (req, res) => {
    const rid = requestId();
    const { staffTenant } = ctx(req);
    const c = await deps.store.getCase(staffTenant.id, req.params.caseId);
    if (!c) return res.status(404).json(errorBody("NOT_FOUND", "Case not found.", rid));
    const [facts, messages, attachments, handoffs, events, assessment, outcome] = await Promise.all([
      deps.store.listFacts(staffTenant.id, c.id),
      deps.store.listMessages(staffTenant.id, c.id),
      deps.store.listAttachments(staffTenant.id, c.id),
      deps.store.listHandoffs(staffTenant.id, c.id),
      deps.store.listEvents(staffTenant.id, c.id),
      deps.store.getAssessment(staffTenant.id, c.id),
      deps.store.getOutcome(staffTenant.id, c.id),
    ]);
    res.json({ case: c, facts, messages, attachments, handoffs, events, assessment, outcome });
  });

  app.patch("/api/v1/staff/cases/:caseId", staffAuth, requireMutate, async (req, res) => {
    const rid = requestId();
    const { staffTenant } = ctx(req);
    const schema = z.object({
      workflowStatus: z.enum(["draft", "new", "reviewing", "contacted", "scheduled", "closed", "cancelled"]).optional(),
      safetyStatus: z.enum(["unchecked", "no_hazard_reported", "needs_review", "stop_use", "emergency"]).optional(),
      assignee: z.string().max(120).nullish(),
      note: z.string().max(2000).nullish(),
      version: z.number(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(errorBody("VALIDATION_ERROR", "Invalid update.", rid));
    const c = await deps.store.getCase(staffTenant.id, req.params.caseId);
    if (!c) return res.status(404).json(errorBody("NOT_FOUND", "Case not found.", rid));
    if (parsed.data.version !== c.version) {
      return res.status(409).json(errorBody("CASE_VERSION_CONFLICT", "This case changed. Refresh before saving.", rid));
    }
    if (parsed.data.workflowStatus) c.workflowStatus = parsed.data.workflowStatus;
    if (parsed.data.safetyStatus) c.safetyStatus = parsed.data.safetyStatus;
    const now = new Date().toISOString();
    c.version += 1;
    c.updatedAt = now;
    await deps.store.updateCase(c);
    await deps.store.addEvent({
      id: randomUUID(), tenantId: staffTenant.id, caseId: c.id, type: "staff_update",
      payload: { workflowStatus: parsed.data.workflowStatus ?? null, assignee: parsed.data.assignee ?? null, note: parsed.data.note ?? null },
      createdAt: now,
    });
    // Enqueue status webhook on operational change.
    if (parsed.data.workflowStatus && ["contacted", "scheduled", "closed", "cancelled"].includes(parsed.data.workflowStatus)) {
      await deps.store.enqueueJob({
        id: randomUUID(), tenantId: staffTenant.id, caseId: c.id, kind: "webhook",
        payload: { eventType: parsed.data.workflowStatus === "closed" || parsed.data.workflowStatus === "cancelled" ? "case.closed" : "case.status_updated", handoffVersion: 0 },
        status: "pending", attempts: 0, maxAttempts: 8, leaseUntil: null, lastError: null, createdAt: now, updatedAt: now,
      });
    }
    res.json({ ok: true, version: c.version });
  });

  // Append-only technician review; submitted snapshots remain unchanged.
  app.post("/api/v1/staff/cases/:caseId/review", staffAuth, requireMutate, async (req, res) => {
    const { staffTenant, staffSession } = ctx(req);
    const parsed = z.object({
      version: z.number().int(),
      disposition: z.enum(["ready_to_contact", "need_information", "urgent_review"]),
      revisedBrief: z.string().min(1).max(12000).optional(),
      missingFacts: z.array(z.string().max(300)).max(30),
      unsupportedAssertions: z.array(z.string().max(500)).max(30),
      unnecessaryQuestionIds: z.array(z.string().max(80)).max(30).default([]),
      reviewSeconds: z.number().nonnegative().max(86400).nullable(),
      timingMethod: z.enum(["manual", "measured", "estimated", "not_recorded"]),
      note: z.string().max(2000).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json(errorBody("VALIDATION_ERROR", "Invalid technician review.", requestId()));
    const c = await deps.store.getCase(staffTenant.id, req.params.caseId);
    if (!c) return res.status(404).json(errorBody("NOT_FOUND", "Case not found.", requestId()));
    if (parsed.data.version !== c.version) return res.status(409).json(errorBody("CASE_VERSION_CONFLICT", "Refresh before reviewing.", requestId()));
    if (c.conversationPhase !== "submitted") return res.status(409).json(errorBody("VALIDATION_ERROR", "Review a submitted brief.", requestId()));
    const events = await deps.store.listEvents(staffTenant.id, c.id);
    const event = { id: randomUUID(), tenantId: staffTenant.id, caseId: c.id, type: "technician_review",
      payload: { ...parsed.data, revision: events.filter(e => e.type === "technician_review").length + 1,
        recordedBy: staffSession.userId, approved: parsed.data.disposition === "ready_to_contact" }, createdAt: new Date().toISOString() };
    await deps.store.addEvent(event);
    res.status(201).json({ review: event });
  });

  app.post("/api/v1/staff/cases/:caseId/outcome", staffAuth, requireMutate, async (req, res) => {
    const rid = requestId();
    const { staffTenant, staffSession } = ctx(req);
    const schema = z.object({
      rating: z.enum(["useful_as_received", "useful_after_corrections", "needed_followup", "misleading_or_unusable"]),
      confirmedIssue: z.string().max(2000).nullish(),
      hypothesesUseful: z.boolean().nullish(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(errorBody("VALIDATION_ERROR", "Invalid outcome.", rid));
    const c = await deps.store.getCase(staffTenant.id, req.params.caseId);
    if (!c) return res.status(404).json(errorBody("NOT_FOUND", "Case not found.", rid));
    await deps.store.saveOutcome({
      caseId: c.id, tenantId: staffTenant.id, rating: parsed.data.rating,
      confirmedIssue: parsed.data.confirmedIssue ?? null,
      hypothesesUseful: parsed.data.hypothesesUseful ?? null,
      recordedBy: staffSession.userId, recordedAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  });

  app.get("/api/v1/staff/knowledge", staffAuth, async (req, res) => {
    const { staffTenant } = ctx(req);
    const [documents, chunks] = await Promise.all([
      deps.store.listDocuments(staffTenant.id),
      deps.store.listChunks(staffTenant.id),
    ]);
    res.json({ documents, chunks });
  });

  app.get("/api/v1/staff/cases/:caseId/attachments/:attachmentId", staffAuth, async (req, res) => {
    const rid = requestId();
    const { staffTenant } = ctx(req);
    const c = await deps.store.getCase(staffTenant.id, req.params.caseId);
    if (!c) return res.status(404).json(errorBody("NOT_FOUND", "Case not found.", rid));
    const atts = await deps.store.listAttachments(staffTenant.id, c.id);
    const att = atts.find((a) => a.id === req.params.attachmentId);
    if (!att) return res.status(404).json(errorBody("NOT_FOUND", "Attachment not found.", rid));
    const buf = await deps.storage.get(att.storageKey);
    if (!buf) return res.status(404).json(errorBody("NOT_FOUND", "File missing.", rid));
    await deps.store.addEvent({
      id: randomUUID(), tenantId: staffTenant.id, caseId: c.id, type: "staff_photo_view",
      payload: { attachmentId: att.id }, createdAt: new Date().toISOString(),
    });
    res.setHeader("content-type", att.mimeType);
    res.setHeader("cache-control", "private, max-age=60");
    res.send(Buffer.from(buf));
  });

  app.get("/api/v1/staff/settings", staffAuth, async (req, res) => {
    const { staffTenant } = ctx(req);
    const tenant = await deps.store.getTenant(staffTenant.id);
    const [endpoints, deliveries, documents, chunks, credentials] = await Promise.all([
      deps.store.listEndpoints(staffTenant.id),
      deps.store.listDeliveries(staffTenant.id),
      deps.store.listDocuments(staffTenant.id),
      deps.store.listChunks(staffTenant.id),
      deps.store.listServiceCredentials(staffTenant.id),
    ]);
    res.json({
      tenant,
      webhooks: {
        endpoints: endpoints.map((e) => ({ id: e.id, url: e.url, events: e.events, active: e.active })),
        deliveries: deliveries.slice(0, 20),
      },
      knowledge: {
        documents: documents.map((d) => ({ id: d.id, title: d.title, version: d.version, reviewStatus: d.reviewStatus, visibility: d.visibility })),
        chunkCount: chunks.length,
      },
      serviceCredentials: credentials,
    });
  });

  app.get("/api/v1/staff/metrics", staffAuth, async (req, res) => {
    const { staffTenant } = ctx(req);
    const cases = await deps.store.listCases(staffTenant.id);
    const submitted = cases.filter((c) => c.conversationPhase === "submitted");
    res.json({
      started: cases.length,
      submitted: submitted.length,
      completionRate: cases.length ? submitted.length / cases.length : 0,
      bySafety: Object.fromEntries(
        ["unchecked", "no_hazard_reported", "needs_review", "stop_use", "emergency"].map((s) => [s, cases.filter((c) => c.safetyStatus === s).length])
      ),
    });
  });
}
