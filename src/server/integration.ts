// Business-system integration endpoints (scoped service keys).
import express from "express";
import { z } from "zod";
import type { AppDeps } from "./app.js";
import { errorBody } from "../domain/types.js";
import { requestId, sha256 } from "./auth.js";
import { createCase } from "../domain/intake.js";
import { newToken } from "./auth.js";
import { randomUUID } from "node:crypto";

export function registerIntegrationRoutes(app: express.Express, deps: AppDeps): void {
  async function svcAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const rid = requestId();
    const h = String(req.headers.authorization ?? "");
    const m = h.match(/^Bearer (.+)$/);
    if (!m) return res.status(401).json(errorBody("UNAUTHORIZED", "Missing service key.", rid));
    const cred = await deps.store.getServiceCredentialByHash(sha256(m[1]));
    if (!cred) return res.status(401).json(errorBody("UNAUTHORIZED", "Invalid service key.", rid));
    const tenant = await deps.store.getTenant(cred.tenantId);
    if (!tenant) return res.status(401).json(errorBody("UNAUTHORIZED", "Unknown tenant.", rid));
    (req as unknown as { svcTenant: typeof tenant; scopes: string[] }).svcTenant = tenant;
    (req as unknown as { scopes: string[] }).scopes = cred.scopes;
    next();
  }

  app.post("/api/v1/integration/sessions", svcAuth, async (req, res) => {
    const rid = requestId();
    const { svcTenant } = req as unknown as { svcTenant: Parameters<typeof createCase>[1] };
    const schema = z.object({ externalReference: z.string().max(120).nullish() });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(errorBody("VALIDATION_ERROR", "Invalid request.", rid));
    const c = await createCase(
      { store: deps.store, provider: deps.provider, storageGet: (k) => deps.storage.get(k) },
      svcTenant, "integration", parsed.data.externalReference ?? null
    );
    const token = newToken("ct");
    const now = new Date().toISOString();
    await deps.store.createSession({
      id: randomUUID(), tenantId: svcTenant.id, caseId: c.id, tokenHash: sha256(token),
      bootstrapCodeHash: null, bootstrapUsed: true, createdAt: now,
      expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
    });
    res.status(201).json({ caseId: c.id, reference: c.reference, token, externalReference: c.externalReference });
  });

  app.get("/api/v1/integration/cases/:caseId/handoff", svcAuth, async (req, res) => {
    const rid = requestId();
    const { svcTenant } = req as unknown as { svcTenant: { id: string } };
    const c = await deps.store.getCase(svcTenant.id, req.params.caseId);
    if (!c) return res.status(404).json(errorBody("NOT_FOUND", "Case not found.", rid));
    const handoffs = await deps.store.listHandoffs(svcTenant.id, c.id);
    if (handoffs.length === 0) return res.status(404).json(errorBody("NOT_FOUND", "No handoff yet.", rid));
    const latest = handoffs[handoffs.length - 1];
    res.json({ caseId: c.id, reference: c.reference, version: latest.version, handoff: latest.snapshot });
  });
}
