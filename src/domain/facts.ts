// Fact validation: allowed keys, conflict detection, unknown handling.
import type { CaseFact } from "./types.js";

export const FACT_KEYS = [
  "appliance_category",
  "problem_description",
  "service_zip",
  "street_address",
  "brand",
  "model_number",
  "model_number_raw",
  "model_confirmed",
  "label_inaccessible",
  "serial_number",
  "appliance_age",
  "error_code",
  "display_reading",
  "cooling_scope",
  "sound_observation",
  "leak_observation",
  "failure_stage",
  "drain_observation",
  "load_observation",
  "contact_name",
  "contact_channel",
  "preferred_window",
  "service_area_acknowledged",
  "consent",
] as const;

const UNKNOWN_TOKENS = new Set(["unknown", "i don't know", "idk", "not sure", "n/a", "skip", "skipped"]);

export function isUnknownValue(v: string | number | boolean | null): boolean {
  if (v === null) return true;
  if (typeof v !== "string") return false;
  return UNKNOWN_TOKENS.has(v.trim().toLowerCase());
}

export function normalizeFact(key: string, value: string | number | boolean | null): string | number | boolean | null {
  if (typeof value === "string") {
    const t = value.trim();
    if (key === "error_code" || key === "display_reading" || key === "model_number") return t; // verbatim
    if (key === "service_zip") return t.replace(/\s+/g, "").slice(0, 10);
    if (key === "appliance_category") return t.toLowerCase().replace(/\s+/g, "_").slice(0, 40);
    return t.slice(0, 2000);
  }
  return value;
}

export interface Conflict { key: string; existing: unknown; proposed: unknown }

export function detectConflicts(
  existing: CaseFact[],
  proposed: Array<{ key: string; value: string | number | boolean | null }>
): Conflict[] {
  const conflicts: Conflict[] = [];
  const latest = new Map<string, CaseFact>();
  for (const f of existing) {
    if (f.status === "superseded") continue;
    latest.set(f.key, f);
  }
  for (const p of proposed) {
    const cur = latest.get(p.key);
    if (!cur) continue;
    const a = String(cur.value ?? "").trim().toLowerCase();
    const b = String(p.value ?? "").trim().toLowerCase();
    if (a !== b && !isUnknownValue(p.value) && !isUnknownValue(cur.value)) {
      conflicts.push({ key: p.key, existing: cur.value, proposed: p.value });
    }
  }
  return conflicts;
}

export function isAllowedKey(key: string): boolean {
  return (FACT_KEYS as readonly string[]).includes(key);
}
