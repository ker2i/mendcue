// Auth helpers: opaque Bearer tokens (hashed at rest), bootstrap codes, staff cookies, CSRF.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Request } from "express";

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function newToken(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

export function newBootstrapCode(): string {
  return randomBytes(16).toString("base64url");
}

export function bearerFrom(req: Request): string | null {
  const h = req.headers.authorization ?? "";
  const m = h.match(/^Bearer (.+)$/);
  return m ? m[1] : null;
}

export function requestId(): string {
  return randomUUID();
}

// Tiny in-memory abuse limiter (per key + window). Replace with Redis for scale.
const buckets = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= max;
}

export function csrfToken(): string {
  return randomBytes(24).toString("base64url");
}
