import { randomUUID } from "node:crypto";
import type { JobRecord } from "../db/store.js";
import type { CaseRecord } from "./types.js";
import { buildEvent, type WebhookEvent } from "../integrations/webhooks/sign.js";

export function webhookJob(c: CaseRecord, eventType: WebhookEvent["event_type"], handoffVersion: number): JobRecord {
  const event = buildEvent(eventType, c.id, c.externalReference, handoffVersion, c.version);
  return { id: randomUUID(), tenantId: c.tenantId, caseId: c.id, kind: "webhook",
    payload: { eventType, handoffVersion, event }, status: "pending", attempts: 0, maxAttempts: 8,
    leaseUntil: null, lastError: null, createdAt: event.occurred_at, updatedAt: event.occurred_at, availableAt: event.occurred_at };
}
