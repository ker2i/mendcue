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
        await deps.store.completeJob(job.id);
        return true;
      }
      const messageId = String(job.payload.messageId ?? "");
      const messages = await deps.store.listMessages(job.tenantId, job.caseId);
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) throw new Error("message gone");
      // Discard stale output if a newer customer message arrived after this one.
      const idx = messages.findIndex((m) => m.id === messageId);
      const newer = messages.slice(idx + 1).some((m) => m.role === "customer");
      if (newer) {
        await deps.store.completeJob(job.id);
        return true;
      }
      await processTurn(
        { store: deps.store, provider: deps.provider, storageGet: (k) => deps.storage.get(k) },
        tenant, job.caseId, messageId, msg.body
      );
    } else if (job.kind === "webhook" && job.caseId) {
      await deliverWebhooks(deps, job.tenantId, job.caseId, job.payload);
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
    await deps.store.completeJob(job.id);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "job failed";
    const backoff = Math.min(300_000, 5000 * 2 ** job.attempts);
    const retry = job.attempts < job.maxAttempts
      ? new Date(Date.now() + backoff).toISOString()
      : null;
    await deps.store.failJob(job.id, msg.slice(0, 500), retry);
    return true;
  }
}

async function deliverWebhooks(
  deps: WorkerDeps, tenantId: string, caseId: string, payload: Record<string, unknown>
): Promise<void> {
  const endpoints = (await deps.store.listEndpoints(tenantId)).filter((e) => e.active);
  if (endpoints.length === 0) return;
  const c = await deps.store.getCase(tenantId, caseId);
  const eventType = String(payload.eventType ?? "case.status_updated") as
    "case.submitted" | "case.handoff_updated" | "case.status_updated" | "case.closed";
  const handoffVersion = Number(payload.handoffVersion ?? 0);
  for (const ep of endpoints) {
    if (ep.events.length > 0 && !ep.events.includes(eventType)) continue;
    const deliveries = await deps.store.listDeliveries(tenantId);
    const seq = deliveries.length + 1;
    const event = buildEvent(eventType, caseId, c?.externalReference ?? null, handoffVersion, seq);
    const body = JSON.stringify(event);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signWebhook(ep.secret, ts, body);
    const now = new Date().toISOString();
    try {
      const res = await fetch(ep.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-intake-timestamp": ts,
          "x-intake-signature": `sha256=${sig}`,
          "x-intake-event-id": event.event_id,
        },
        body,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`receiver ${res.status}`);
      await deps.store.saveDelivery({
        id: randomUUID(), tenantId, endpointId: ep.id, eventId: event.event_id,
        eventType, status: "delivered", attempts: 1, lastError: null, createdAt: now,
      });
    } catch (e) {
      await deps.store.saveDelivery({
        id: randomUUID(), tenantId, endpointId: ep.id, eventId: event.event_id,
        eventType, status: "failed", attempts: 1,
        lastError: (e instanceof Error ? e.message : "delivery failed").slice(0, 300),
        createdAt: now,
      });
      throw e; // job retry handles backoff
    }
  }
}

export async function runWorker(deps: WorkerDeps, stop: { stopped: boolean }): Promise<void> {
  const pollMs = deps.pollMs ?? 2000;
  while (!stop.stopped) {
    const did = await processOneJob(deps);
    if (!did) await new Promise((r) => setTimeout(r, pollMs));
  }
}

export { submitCase };
