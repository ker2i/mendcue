// Recall lookup interface. CPSC-backed matching is a later step; states and
// confirmation rules are implemented now so callers handle them correctly.
import type { RecallState } from "../domain/types.js";

export interface RecallCheck {
  state: RecallState;
  noticeUrl: string | null;
  matchedOn: string[];
  retrievedAt: string | null;
  disclaimer: string;
}

const DISCLAIMER = "Recall screening is informational. 'No match found' is not a guarantee that the appliance has no recall.";

export async function checkRecall(_args: {
  brand: string | null;
  model: string | null;
  serial: string | null;
}): Promise<RecallCheck> {
  // No CPSC fetch wired in hackathon scope: report honestly as not checked.
  return {
    state: "not_checked",
    noticeUrl: null,
    matchedOn: [],
    retrievedAt: null,
    disclaimer: DISCLAIMER,
  };
}
