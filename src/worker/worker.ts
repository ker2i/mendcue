// Background worker: leases durable jobs, runs turn processing and webhook delivery.
// One worker loop; run as a separate process in Docker (same image, `worker` cmd).
import type { Store } from "../db/store.js";
import type { ModelProvider } from "../integrations/meta/provider.js";
import type { StorageAdapter } from "../integrations/storage/storage.js";
import { processTurn, submitCase } from "../domain/intake.js";
import { buildEvent, signWebhook } from "../integrations/webhooks/sign.js";
import { randomUUID } from "node:crypto";

export interface WorkerDeps {
  store: Store;
  provider: ModelProvider;
  storage: StorageAdapter;
  pollMs?: number;
  heartbeat?: () => void;
}

export async function processOneJob(deps: WorkerDeps): Promise<boolean> {
  const now = new Date().toISOString();
  const job = await deps.store.leaseJob(now);
  if (!job) return false;
  try {
    if (job.kind === "turn" && job.caseId) {
      const tenant = await deps.store.getTenant(job.tenantId);
      if (!tenant) throw new Error("unknown tenant");
      // Recheck case state before committing generated output.
      const c = await deps.store.getCase(job.tenantId, job.caseId);
      if (!c) throw new Error("case gone");
      if (c.conversationPhase === "submitted" || c.conversationPhase === "closed") {
        await deps.store.completeJob(job.id, job.leaseVersion);
        return true;
      }
      const messageId = String(job.payload.messageId ?? "");
      const messages = await deps.store.listMessages(job.tenantId, job.caseId);
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) throw new Error("message gone");
      const consent = typeof job.payload.consent === "boolean" ? job.payload.consent : undefined;
      await processTurn(
        { store: deps.store, provider: deps.provider, storageGet: (k) => deps.storage.get(k) },
        tenant, job.caseId, messageId, msg.body, { consent }
      );
    } else if (job.kind === "storage_delete") {
      if(!deps.storage.delete)throw new Error("Storage deletion not supported");
      for(const key of (job.payload.keys ?? []) as string[])await deps.storage.delete(key);
    } else if (job.kind === "notification") {
      const { sendNotification } = await import("../integrations/notifications.js");
      await sendNotification(job);
    } else if (job.kind === "webhook" && job.caseId) {
      await deliverWebhooks(deps, job);
    } else if (job.kind === "label" && job.caseId) {
      const { processLabelPhoto } = await import("../domain/intake.js");
      const tenant = await deps.store.getTenant(job.tenantId);
      if (!tenant) throw new Error("unknown tenant");
      await processLabelPhoto(
        { store: deps.store, provider: deps.provider, storageGet: (k) => deps.storage.get(k) },
        tenant, job.caseId, String(job.payload.attachmentId ?? "")
      );
    } else {
      throw new Error(`unknown job kind ${job.kind}`);
    }
    await deps.store.completeJob(job.id, job.leaseVersion);
    return true;
  } catch (e) {
    const backoff = Math.min(300_000, 5000 * 2 ** job.attempts);
    const retry = job.attempts < job.maxAttempts
      ? new Date(Date.now() + backoff).toISOString()
      : null;
    await deps.store.failJob(job.id, "Job processing failed", retry, job.leaseVersion);
    return true;
  }
}

async function deliverWebhooks(deps: WorkerDeps, job: import("../db/store.js").JobRecord): Promise<void> {
  const { tenantId, caseId } = job;
  const endpoints = (await deps.store.listEndpoints(tenantId)).filter(e => e.active);
  const payload = job.payload;
  // Upgrade pre-migration jobs once, before any network request.
  if (!payload.event || !payload.endpointIds || typeof payload.eventBody !== "string") {
    const c = await deps.store.getCase(tenantId, caseId!);
    const event = payload.event ?? { ...buildEvent(String(payload.eventType ?? "case.status_updated") as import("../integrations/webhooks/sign.js").WebhookEvent["event_type"], caseId!, c?.externalReference ?? null, Number(payload.handoffVersion ?? 0), c?.version ?? 0), event_id: job.id, occurred_at: job.createdAt };
    payload.event = event;
    payload.eventBody = JSON.stringify(event);
    const type = (event as { event_type: string }).event_type;
    payload.endpointIds = endpoints.filter(e => !e.events.length || e.events.includes(type)).map(e => e.id);
    await deps.store.updateJobPayload(tenantId, job.id, payload);
  }
  const event = payload.event as import("../integrations/webhooks/sign.js").WebhookEvent;
  const body = String(payload.eventBody);
  const deliveries = await deps.store.listDeliveries(tenantId, event.event_id);
  let failed = false;
  for (const endpointId of payload.endpointIds as string[]) {
    const ep = endpoints.find(e => e.id === endpointId);
    if (!ep) continue; // Disabled/deleted endpoints are intentionally suppressed.
    const previous = deliveries.find(d => d.endpointId === ep.id);
    if (previous?.status === "delivered") continue;
    const ts = String(Math.floor(Date.now() / 1000));
    const delivery = { id: previous?.id ?? randomUUID(), tenantId, endpointId: ep.id,
      eventId: event.event_id, eventType: event.event_type, status: "delivered", attempts: (previous?.attempts ?? 0) + 1,
      lastError: null as string | null, createdAt: previous?.createdAt ?? new Date().toISOString() };
    try {
      const res = await fetch(ep.url, { method: "POST", redirect: "error",
        headers: { "content-type": "application/json", "x-intake-timestamp": ts,
          "x-intake-signature": `sha256=${signWebhook(ep.secret, ts, body)}`, "x-intake-event-id": event.event_id },
        body, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error("receiver rejected request");
    } catch {
      failed = true; delivery.status = "failed"; delivery.lastError = "Webhook delivery failed";
    }
    await deps.store.saveDelivery(delivery);
  }
  if (failed) throw new Error("Webhook delivery incomplete");
}

export async function runWorker(deps: WorkerDeps, stop: { stopped: boolean }): Promise<void> {
  const pollMs = deps.pollMs ?? 2000;
  let nextRetention=0;
  while (!stop.stopped) {
    if(Date.now()>=nextRetention){
      for(const tenant of await deps.store.listTenants()){
        await deps.store.purgeExpired(tenant,new Date().toISOString());
        if(process.env.PRIVATE_ARTIFACT_ROOT){const {pruneArtifacts}=await import("../operator/artifact-retention.js");await pruneArtifacts(process.env.PRIVATE_ARTIFACT_ROOT,tenant.id,tenant.retention.logDays);}
      }
      nextRetention=Date.now()+3600000;
    }
    const did = await processOneJob(deps);
    deps.heartbeat?.();
    if (!did) await new Promise((r) => setTimeout(r, pollMs));
  }
}

export { submitCase };
