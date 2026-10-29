// Deterministic safety screening. Runs before any model call.
export type HazardType =
  | "gas_leak"
  | "smoke_fire"
  | "sparking"
  | "shock"
  | "water_electric"
  | "other_danger";

export interface HazardHit {
  type: HazardType;
  evidenceText: string;
  possibleCurrentDanger: boolean;
}

const PATTERNS: Array<{ type: HazardType; re: RegExp; danger: boolean }> = [
  { type: "gas_leak", re: /\b(gas\s*(leak|smell|odor|odour)|smell(s|ed|ing)?\s+gas|rotten\s*egg\s*smell)\b/i, danger: true },
  { type: "smoke_fire", re: /\b(smoke|flames?|fire|burning\s*smell|on\s*fire)\b/i, danger: true },
  { type: "sparking", re: /\b(spark(s|ing|ed)?|arcing)\b/i, danger: true },
  { type: "shock", re: /\b((electric\s*)?shock(ed|s|ing)?|electrocut)/i, danger: true },
  { type: "water_electric", re: /\b(water\s*(near|on|around|touching).*(outlet|socket|plug|wire|electr|panel)|flooded.*(outlet|electr))/i, danger: true },
  { type: "other_danger", re: /\b(explosion|exploded|melted\s*(plug|wire|outlet)|hot\s*(outlet|panel|wires?))\b/i, danger: true },
];

export function screenHazards(text: string): HazardHit[] {
  const hits: HazardHit[] = [];
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m) {
      hits.push({ type: p.type, evidenceText: m[0].slice(0, 200), possibleCurrentDanger: p.danger });
    }
  }
  return hits;
}

export function gasLeakScript(utilityContact: string): string {
  return (
    `Possible gas leak — stop here. Leave the area now, do not flip switches or operate ` +
    `appliance controls, and from a safe place call emergency services and your gas utility ` +
    `(${utilityContact}). Once you are safe, tell me you are safe or ask for a person and I will ` +
    `prepare a handoff for the service team.`
  );
}

export function generalHazardScript(kind: string): string {
  return (
    `That sounds potentially dangerous (${kind}). Stop using the appliance, keep people away ` +
    `from it, and if there is smoke, fire, sparking, or anyone received a shock, call emergency ` +
    `services first. Tell me when you are safe and I will collect the remaining details for the ` +
    `service team, or ask for a person at any time.`
  );
}

// Forbidden customer-directed actions: the assistant must never emit these.
export const FORBIDDEN_ACTION_PATTERNS: RegExp[] = [
  /remove\s+(the\s+)?(cover|panel|back)/i,
  /live\s+(electrical\s*)?(measurement|test|voltage)/i,
  /bypass\s+(the\s+)?(interlock|fuse|breaker|protection)/i,
  /gas\s+(connection|line|valve|fitting)/i,
  /refrigerant/i,
  /reset\s+(the\s+)?breaker.*again/i,
  /move\s+(the\s+)?(heavy\s+)?appliance/i,
];

export function containsForbiddenAction(text: string): boolean {
  return FORBIDDEN_ACTION_PATTERNS.some((re) => re.test(text));
}
