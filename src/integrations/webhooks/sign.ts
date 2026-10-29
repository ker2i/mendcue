// Signed webhook helpers: timestamped HMAC over exact bytes, unique event ids.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export interface WebhookEvent {
  event_id: string;
  event_type: "case.submitted" | "case.handoff_updated" | "case.status_updated" | "case.closed";
  schema_version: "1";
  occurred_at: string;
  case_id: string;
  external_reference: string | null;
  handoff_version: number;
  seq: number;
}

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifyWebhook(secret: string, timestamp: string, body: string, signature: string): boolean {
  const expected = signWebhook(secret, timestamp, body);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildEvent(
  type: WebhookEvent["event_type"],
  caseId: string,
  externalReference: string | null,
  handoffVersion: number,
  seq: number
): WebhookEvent {
  return {
    event_id: randomUUID(),
    event_type: type,
    schema_version: "1",
    occurred_at: new Date().toISOString(),
    case_id: caseId,
    external_reference: externalReference,
    handoff_version: handoffVersion,
    seq,
  };
}

// SSRF protection: only https, no localhost/private hosts unless explicitly allowed for tests.
export function validateEndpointUrl(url: string, allowInsecure = false): void {
  const u = new URL(url);
  if (u.protocol !== "https:" && !(allowInsecure && (u.protocol === "http:"))) {
    throw new Error("webhook endpoint must be https");
  }
  const host = u.hostname.toLowerCase();
  const blocked = ["localhost", "127.0.0.1", "::1", "0.0.0.0", "169.254.169.254"];
  if (!allowInsecure && (blocked.includes(host) || host.endsWith(".internal") || host.endsWith(".local"))) {
    throw new Error("webhook endpoint host blocked");
  }
}
