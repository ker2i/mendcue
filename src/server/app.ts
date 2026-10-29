// Express application factory. All routes are tenant-scoped.
import express from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "../db/store.js";
import type { ModelProvider } from "../integrations/meta/provider.js";
import type { StorageAdapter } from "../integrations/storage/storage.js";
import { detectImageMime } from "../integrations/storage/storage.js";
import { errorBody, type TenantConfig } from "../domain/types.js";
import { bearerFrom, csrfToken, newBootstrapCode, newToken, rateLimit, requestId, sha256 } from "./auth.js";
import { confirmModel, createCase, processLabelPhoto, processTurn, submitCase } from "../domain/intake.js";
import { validateEndpointUrl } from "../integrations/webhooks/sign.js";

export interface AppDeps {
  store: Store;
  provider: ModelProvider;
  storage: StorageAdapter;
  baseUrl: string;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 2 },
});

function syncTurns(): boolean {
  return (process.env.SYNC_TURNS ?? "1") !== "0";
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());

  // ---- health ----
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, provider: deps.provider.mode, time: new Date().toISOString() });
  });

  // ---- public widget config ----
  app.get("/api/v1/public/widget-config/:publicKey", async (req, res) => {
    const t = await deps.store.getTenantByPublicKey(req.params.publicKey);
    if (!t) return res.status(404).json(errorBody("NOT_FOUND", "Unknown organization key.", requestId()));
    res.json({
      tenant: t.slug,
      businessName: t.name,
      demoLabel: t.demoLabel,
      branding: t.branding,
      openingMessage: t.openingMessage,
      privacyText: t.privacyText,
      categories: t.categories,
      features: t.featureFlags,
      mode: "launcher",
    });
  });

  // ---- start anonymous intake ----
  app.post("/api/v1/public/sessions", async (req, res) => {
    const rid = requestId();
    const schema = z.object({ publicKey: z.string().min(1), source: z.enum(["widget", "hosted"]).default("widget") });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(errorBody("VALIDATION_ERROR", "Invalid session request.", rid));
    const t = await deps.store.getTenantByPublicKey(parsed.data.publicKey);
    if (!t) return res.status(404).json(errorBody("NOT_FOUND", "Unknown organization key.", rid));
    // Origin check for browser embeds.
    const origin = String(req.headers.origin ?? "");
    if (origin && !t.allowedOrigins.includes(origin)) {
      return res.status(403).json(errorBody("ORIGIN_NOT_ALLOWED", "This website is not enabled for intake.", rid));
    }
    const ip = String(req.ip ?? "unknown");
    if (!rateLimit(`sess:${ip}`, 30, 60_000)) {
      return res.status(429).json(errorBody("RATE_LIMITED", "Too many requests.", rid));
    }
    const c = await createCase({ store: deps.store, provider: deps.provider, storageGet: (k) => deps.storage.get(k) }, t, parsed.data.source);
    const code = newBootstrapCode();
    const token = newToken("ct");
    const now = new Date().toISOString();
    await deps.store.createSession({
      id: randomUUID(), tenantId: t.id, caseId: c.id,
      tokenHash: sha256(token), bootstrapCodeHash: sha256(code), bootstrapUsed: false,
      createdAt: now, expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
    });
    res.status(201).json({
      caseId: c.id, reference: c.reference, bootstrapCode: code,
      iframeUrl: `${deps.baseUrl}/embed?tenant=${encodeURIComponent(t.slug)}`,
      openingMessage: t.openingMessage, privacyText: t.privacyText,
      // Token is delivered to the test client directly; browsers must use /sessions/exchange.
      _devToken: process.env.NODE_ENV === "test" ? token : undefined,
    });
  });

  // ---- exchange bootstrap code (iframe only) ----
  app.post("/api/v1/sessions/exchange", async (req, res) => {
    const rid = requestId();
    const schema = z.object({ code: z.string().min(8) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(errorBody("VALIDATION_ERROR", "Invalid code.", rid));
    const s = await deps.store.getSessionByBootstrapHash(sha256(parsed.data.code));
    if (!s || s.bootstrapUsed) return res.status(401).json(errorBody("UNAUTHORIZED", "Invalid or used code.", rid));
    await deps.store.markBootstrapUsed(s.id);
    // Issue the case token: we stored only its hash, so mint a fresh one here.
    const token = newToken("ct");
    const now = new Date().toISOString();
    await deps.store.createSession({
      id: randomUUID(), tenantId: s.tenantId, caseId: s.caseId,
      tokenHash: sha256(token), bootstrapCodeHash: null, bootstrapUsed: true,
      createdAt: now, expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
    });
    res.json({ caseId: s.caseId, token });
  });

  // ---- case auth middleware ----
  async function caseAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const rid = requestId();
    const token = bearerFrom(req);
    if (!token) return res.status(401).json(errorBody("UNAUTHORIZED", "Missing case token.", rid));
    const s = await deps.store.getSessionByTokenHash(sha256(token));
    if (!s || s.expiresAt < new Date().toISOString()) {
      return res.status(401).json(errorBody("UNAUTHORIZED", "Invalid session.", rid));
    }
    const t = await deps.store.getTenant(s.tenantId);
    if (!t) return res.status(401).json(errorBody("UNAUTHORIZED", "Unknown tenant.", rid));
    if (req.params.caseId && req.params.caseId !== s.caseId) {
      return res.status(403).json(errorBody("FORBIDDEN", "Token does not grant this case.", rid));
    }
    (req as unknown as { session: typeof s; tenant: TenantConfig }).session = s;
    (req as unknown as { tenant: TenantConfig }).tenant = t;
    next();
  }

  const getCtx = (req: express.Request) =>
    req as unknown as { session: { tenantId: string; caseId: string }; tenant: TenantConfig };

  // ---- read case state ----
  app.get("/api/v1/cases/:caseId", caseAuth, async (req, res) => {
    const { tenant, session } = getCtx(req);
    const c = await deps.store.getCase(tenant.id, session.caseId);
    if (!c) return res.status(404).json(errorBody("NOT_FOUND", "Case not found.", requestId()));
    const facts = await deps.store.listFacts(tenant.id, c.id);
    const messages = await deps.store.listMessages(tenant.id, c.id);
    const attachments = await deps.store.listAttachments(tenant.id, c.id);
    res.json({
      case: { ...c, live: undefined },
      facts: facts.filter((f) => f.status !== "superseded"),
      messages: messages.map((m) => ({ id: m.id, role: m.role, body: m.body, createdAt: m.createdAt })),
      attachments: attachments.map((a) => ({ id: a.id, kind: a.kind, mimeType: a.mimeType, sizeBytes: a.sizeBytes })),
      modelMode: c.modelMode,
      fixtureNotice: c.modelMode !== "live" ? "Development fixture/fallback mode — not a live model result." : null,
    });
  });

  // ---- events (polling JSON; SSE when Accept: text/event-stream) ----
  app.get("/api/v1/cases/:caseId/events", caseAuth, async (req, res) => {
    const { tenant, session } = getCtx(req);
    const events = await deps.store.listEvents(tenant.id, session.caseId);
    const messages = await deps.store.listMessages(tenant.id, session.caseId);
    if (String(req.headers.accept ?? "").includes("text/event-stream")) {
      res.setHeader("content-type", "text/event-stream");
      res.write(`event: state\ndata: ${JSON.stringify({ messages: messages.length, events: events.length })}\n\n`);
      const last = messages[messages.length - 1];
      if (last) res.write(`event: message\ndata: ${JSON.stringify({ id: last.id, role: last.role, body: last.body })}\n\n`);
      res.end();
      return;
    }
    res.json({ events, messageCount: messages.length });
  });

  // ---- post customer message ----
  app.post("/api/v1/cases/:caseId/messages", caseAuth, async (req, res) => {
    const rid = requestId();
    const { tenant, session } = getCtx(req);
    const schema = z.object({ body: z.string().min(1).max(4000) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(errorBody("VALIDATION_ERROR", "Message body required (1–4000 chars).", rid));
    const idem = String(req.headers["idempotency-key"] ?? "");
    if (idem) {
      const seen = await deps.store.idempotencyGet(tenant.id, `msg:${session.caseId}:${idem}`);
      if (seen) return res.status(200).json(JSON.parse(seen));
    }
    const c = await deps.store.getCase(tenant.id, session.caseId);
    if (!c) return res.status(404).json(errorBody("NOT_FOUND", "Case not found.", rid));
    if (c.conversationPhase === "submitted") {
      return res.status(400).json(errorBody("VALIDATION_ERROR", "Case already submitted.", rid));
    }
    const now = new Date().toISOString();
    const msg = { id: randomUUID(), tenantId: tenant.id, caseId: c.id, role: "customer" as const, body: parsed.data.body, createdAt: now };
    await deps.store.addMessage(msg);
    const engine = { store: deps.store, provider: deps.provider, storageGet: (k: string) => deps.storage.get(k) };

    // Model-confirmation shortcut: if the last assistant message asked for confirmation
    // and the customer answers yes/correction, confirm before the normal turn.
    const history = await deps.store.listMessages(tenant.id, c.id);
    const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
    if (lastAssistant && /is that correct|confirm the exact model/i.test(lastAssistant.body)) {
      const conf = await confirmModel(engine, tenant, c.id, msg.id, parsed.data.body);
      if (conf.confirmed) {
        const reply = `Thanks — model recorded as ${conf.model}.`;
        await deps.store.addMessage({ id: randomUUID(), tenantId: tenant.id, caseId: c.id, role: "assistant", body: reply, createdAt: new Date().toISOString() });
        const payload = { reply, confirmed: true, model: conf.model };
        if (idem) await deps.store.idempotencyPut(tenant.id, `msg:${session.caseId}:${idem}`, JSON.stringify(payload));
        return res.status(201).json(payload);
      }
    }

    if (syncTurns()) {
      const outcome = await processTurn(engine, tenant, c.id, msg.id, parsed.data.body);
      const payload = { ...outcome, messageId: msg.id };
      if (idem) await deps.store.idempotencyPut(tenant.id, `msg:${session.caseId}:${idem}`, JSON.stringify(payload));
      return res.status(201).json(payload);
    }
    // Queued mode: one normal turn job per case.
    if (!(await deps.store.hasPendingTurnJob(c.id))) {
      await deps.store.enqueueJob({
        id: randomUUID(), tenantId: tenant.id, caseId: c.id, kind: "turn",
        payload: { messageId: msg.id }, status: "pending", attempts: 0, maxAttempts: 3,
        leaseUntil: null, lastError: null, createdAt: now, updatedAt: now,
      });
    }
    res.status(202).json({ accepted: true, messageId: msg.id, status: "processing" });
  });

  // ---- attachments ----
  app.post("/api/v1/cases/:caseId/attachments", caseAuth, (req, res, next) => {
    upload.single("photo")(req, res, (err: unknown) => {
      if (err) return res.status(400).json(errorBody("PAYLOAD_TOO_LARGE", "Photo must be JPEG/PNG/WebP up to 8 MB.", requestId()));
      next();
    });
  }, async (req, res) => {
    const rid = requestId();
    const { tenant, session } = getCtx(req);
    const kind = String(req.body?.kind ?? "label_photo");
    if (!["label_photo", "error_display", "other"].includes(kind)) {
      return res.status(400).json(errorBody("VALIDATION_ERROR", "Invalid kind.", rid));
    }
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) return res.status(400).json(errorBody("VALIDATION_ERROR", "Field 'photo' required.", rid));
    const count = await deps.store.countAttachments(tenant.id, session.caseId);
    if (count >= 8) return res.status(400).json(errorBody("VALIDATION_ERROR", "Maximum 8 photos per case.", rid));
    const real = detectImageMime(file.buffer);
    if (!real || !["image/jpeg", "image/png", "image/webp"].includes(real)) {
      return res.status(415).json(errorBody("UNSUPPORTED_MEDIA", "Accepted: JPEG, PNG, WebP. If your photo is HEIC, please re-save or screenshot it as JPEG/PNG and retry.", rid));
    }
    const stored = await deps.storage.put(session.caseId, file.originalname || "photo", file.buffer, real);
    const att = {
      id: randomUUID(), tenantId: tenant.id, caseId: session.caseId,
      kind: kind as "label_photo" | "error_display" | "other",
      mimeType: real, sizeBytes: stored.sizeBytes, storageKey: stored.storageKey,
      sha256: stored.sha256, rawOcrText: null as string | null, createdAt: new Date().toISOString(),
    };
    // Test hook: clients may supply known label text for deterministic parsing.
    if (typeof req.body?.labelText === "string" && req.body.labelText.length > 0 && req.body.labelText.length <= 2000) {
      att.rawOcrText = String(req.body.labelText);
    }
    await deps.store.addAttachment(att);
    const engine = { store: deps.store, provider: deps.provider, storageGet: (k: string) => deps.storage.get(k) };
    if (kind === "label_photo" && syncTurns()) {
      const outcome = await processLabelPhoto(engine, tenant, session.caseId, att.id);
      return res.status(201).json({ attachmentId: att.id, ...outcome });
    }
    res.status(201).json({ attachmentId: att.id, reply: "Photo received and stored privately." });
  });

  // ---- serve photo (authenticated) ----
  app.get("/api/v1/cases/:caseId/attachments/:attachmentId", caseAuth, async (req, res) => {
    const { tenant, session } = getCtx(req);
    const atts = await deps.store.listAttachments(tenant.id, session.caseId);
    const att = atts.find((a) => a.id === req.params.attachmentId);
    if (!att) return res.status(404).json(errorBody("NOT_FOUND", "Attachment not found.", requestId()));
    const buf = await deps.storage.get(att.storageKey);
    if (!buf) return res.status(404).json(errorBody("NOT_FOUND", "File missing.", requestId()));
    res.setHeader("content-type", att.mimeType);
    res.setHeader("cache-control", "private, max-age=60");
    res.send(Buffer.from(buf));
  });

  // ---- correct facts ----
  app.patch("/api/v1/cases/:caseId/facts", caseAuth, async (req, res) => {
    const rid = requestId();
    const { tenant, session } = getCtx(req);
    const schema = z.object({ key: z.string().min(1), value: z.union([z.string(), z.number(), z.boolean(), z.null()]), version: z.number() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(errorBody("VALIDATION_ERROR", "key, value, version required.", rid));
    const c = await deps.store.getCase(tenant.id, session.caseId);
    if (!c) return res.status(404).json(errorBody("NOT_FOUND", "Case not found.", rid));
    if (parsed.data.version !== c.version) {
      return res.status(409).json(errorBody("CASE_VERSION_CONFLICT", "This case changed. Refresh before saving.", rid));
    }
    const facts = await deps.store.listFacts(tenant.id, c.id);
    const cur = facts.filter((f) => f.key === parsed.data.key && f.status !== "superseded").pop();
    if (cur) await deps.store.markFactSuperseded(tenant.id, cur.id);
    const now = new Date().toISOString();
    await deps.store.addFact({
      id: randomUUID(), tenantId: tenant.id, caseId: c.id, key: parsed.data.key,
      value: parsed.data.value, status: "reported", sourceMessageId: null, sourceAttachmentId: null,
      certainty: "explicit", createdAt: now, supersedesId: cur?.id ?? null, confirmedBy: "customer", confirmedAt: now,
    });
    c.version += 1;
    c.updatedAt = now;
    await deps.store.updateCase(c);
    await deps.store.addEvent({ id: randomUUID(), tenantId: tenant.id, caseId: c.id, type: "fact_corrected", payload: { key: parsed.data.key }, createdAt: now });
    res.json({ ok: true, version: c.version });
  });

  // ---- submit ----
  app.post("/api/v1/cases/:caseId/submit", caseAuth, async (req, res) => {
    const rid = requestId();
    const { tenant, session } = getCtx(req);
    const idem = String(req.headers["idempotency-key"] ?? "");
    if (idem) {
      const seen = await deps.store.idempotencyGet(tenant.id, `submit:${session.caseId}:${idem}`);
      if (seen) return res.status(200).json(JSON.parse(seen));
    }
    try {
      const engine = { store: deps.store, provider: deps.provider, storageGet: (k: string) => deps.storage.get(k) };
      const result = await submitCase(engine, tenant, session.caseId);
      const c = await deps.store.getCase(tenant.id, session.caseId);
      const payload = { reference: c!.reference, handoffVersion: result.handoffVersion, assessmentStatus: result.assessment.status };
      if (idem) await deps.store.idempotencyPut(tenant.id, `submit:${session.caseId}:${idem}`, JSON.stringify(payload));
      res.status(201).json(payload);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "submit failed";
      if (msg === "already submitted") return res.status(400).json(errorBody("VALIDATION_ERROR", "Already submitted.", rid));
      throw e;
    }
  });

  // ---- request human ----
  app.post("/api/v1/cases/:caseId/request-human", caseAuth, async (req, res) => {
    const { tenant, session } = getCtx(req);
    const c = await deps.store.getCase(tenant.id, session.caseId);
    if (!c) return res.status(404).json(errorBody("NOT_FOUND", "Case not found.", requestId()));
    c.disposition = "human_requested";
    c.version += 1;
    c.updatedAt = new Date().toISOString();
    await deps.store.updateCase(c);
    const now = new Date().toISOString();
    const body = "Understood — I've flagged your case for a person. You can keep adding details or submit what we have.";
    await deps.store.addMessage({ id: randomUUID(), tenantId: tenant.id, caseId: c.id, role: "assistant", body, createdAt: now });
    await deps.store.addEvent({ id: randomUUID(), tenantId: tenant.id, caseId: c.id, type: "human_requested", payload: {}, createdAt: now });
    res.json({ ok: true, reply: body });
  });

  return app;
}
