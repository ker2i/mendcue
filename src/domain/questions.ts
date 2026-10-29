// Approved question registry and versioned customer-action registry.
export interface Question {
  id: string;
  version: string;
  playbook: string;
  categories: string[] | null; // null = all
  text: string;
  factKey: string | null; // fact this question fills
  preconditions: string[]; // required fact keys present
  exclusions: string[]; // hazard types that disable it
}

export interface CustomerAction {
  action_id: string;
  version: string;
  playbook: string;
  instruction: string;
  categories: string[] | null;
  preconditions: string[];
  hazardExclusions: string[];
  source: string;
  expectedObservation: string;
  stopConditions: string;
  reviewStatus: "approved" | "draft";
}

export const QUESTIONS: Question[] = [
  { id: "q_category", version: "v1", playbook: "general", categories: null, text: "Which appliance has the problem? (refrigerator, washer, dishwasher, or other)", factKey: "appliance_category", preconditions: [], exclusions: [] },
  { id: "q_problem", version: "v1", playbook: "general", categories: null, text: "Please describe the problem in your own words.", factKey: "problem_description", preconditions: [], exclusions: [] },
  { id: "q_zip", version: "v1", playbook: "general", categories: null, text: "What is the service ZIP code?", factKey: "service_zip", preconditions: [], exclusions: [] },
  { id: "q_brand", version: "v1", playbook: "general", categories: null, text: "What brand is the appliance? (You can say 'I don't know'.)", factKey: "brand", preconditions: ["appliance_category"], exclusions: [] },
  { id: "q_model", version: "v1", playbook: "general", categories: null, text: "What is the model number? You can photograph the rating label, type it, or say 'label inaccessible'.", factKey: "model_number", preconditions: ["appliance_category"], exclusions: [] },
  { id: "q_age", version: "v1", playbook: "general", categories: null, text: "About how old is the appliance? (You can say 'I don't know'.)", factKey: "appliance_age", preconditions: [], exclusions: [] },
  // Refrigerator follow-ups
  { id: "q_fridge_cooling", version: "v1", playbook: "refrigerator", categories: ["refrigerator", "freezer"], text: "Is the fridge section not cooling, the freezer section, or both?", factKey: "cooling_scope", preconditions: ["appliance_category"], exclusions: [] },
  { id: "q_fridge_display", version: "v1", playbook: "refrigerator", categories: ["refrigerator", "freezer"], text: "Is there anything shown on the display, or any blinking lights? Read exactly what you see.", factKey: "display_reading", preconditions: ["appliance_category"], exclusions: [] },
  { id: "q_fridge_noise", version: "v1", playbook: "refrigerator", categories: ["refrigerator", "freezer"], text: "Do you hear the fan or compressor running, or is it silent?", factKey: "sound_observation", preconditions: ["appliance_category"], exclusions: [] },
  { id: "q_fridge_water", version: "v1", playbook: "refrigerator", categories: ["refrigerator", "freezer"], text: "Is there water leaking or ice building up anywhere you can see without moving the appliance?", factKey: "leak_observation", preconditions: ["appliance_category"], exclusions: ["water_electric"] },
  // Washer follow-ups
  { id: "q_washer_stage", version: "v1", playbook: "washer", categories: ["washer", "washing_machine"], text: "When does it stop — while filling, washing, draining, or spinning?", factKey: "failure_stage", preconditions: ["appliance_category"], exclusions: [] },
  { id: "q_washer_code", version: "v1", playbook: "washer", categories: ["washer", "washing_machine"], text: "Is there an error code on the display? Copy it exactly as shown.", factKey: "error_code", preconditions: ["appliance_category"], exclusions: [] },
  { id: "q_washer_drain", version: "v1", playbook: "washer", categories: ["washer", "washing_machine"], text: "Is water left standing in the drum, or did it drain?", factKey: "drain_observation", preconditions: ["appliance_category"], exclusions: [] },
  { id: "q_washer_load", version: "v1", playbook: "washer", categories: ["washer", "washing_machine"], text: "What size load was in the machine when it failed?", factKey: "load_observation", preconditions: ["appliance_category"], exclusions: [] },
  // Dishwasher follow-ups
  { id: "q_dw_stage", version: "v1", playbook: "dishwasher", categories: ["dishwasher"], text: "When does the problem happen — filling, washing, draining, or drying?", factKey: "failure_stage", preconditions: ["appliance_category"], exclusions: [] },
  { id: "q_dw_code", version: "v1", playbook: "dishwasher", categories: ["dishwasher"], text: "Is there an error code or blinking lights? Copy exactly what you see.", factKey: "error_code", preconditions: ["appliance_category"], exclusions: [] },
  { id: "q_dw_drain", version: "v1", playbook: "dishwasher", categories: ["dishwasher"], text: "Is there standing water in the bottom of the tub?", factKey: "drain_observation", preconditions: ["appliance_category"], exclusions: [] },
  // Contact
  { id: "q_name", version: "v1", playbook: "general", categories: null, text: "What name should the service team use?", factKey: "contact_name", preconditions: [], exclusions: [] },
  { id: "q_contact", version: "v1", playbook: "general", categories: null, text: "What is the best phone number or email to reach you?", factKey: "contact_channel", preconditions: [], exclusions: [] },
  { id: "q_window", version: "v1", playbook: "general", categories: null, text: "What callback or visit windows suit you? (This is a request — the team will confirm.)", factKey: "preferred_window", preconditions: [], exclusions: [] },
];

export const CUSTOMER_ACTIONS: CustomerAction[] = [
  {
    action_id: "act_read_display", version: "v1", playbook: "general",
    instruction: "Read the display or lights exactly as shown, without touching any controls.",
    categories: null, preconditions: [], hazardExclusions: [],
    source: "playbook:general:v1", expectedObservation: "verbatim display text",
    stopConditions: "Stop if the display area is hot, sparking, or wet.",
    reviewStatus: "approved",
  },
  {
    action_id: "act_photo_label", version: "v1", playbook: "general",
    instruction: "Photograph the rating label only if it is already visible without moving the appliance or removing any panel.",
    categories: null, preconditions: [], hazardExclusions: [],
    source: "playbook:general:v1", expectedObservation: "label photo",
    stopConditions: "Do not move the appliance or remove panels.",
    reviewStatus: "approved",
  },
  {
    action_id: "act_describe_timing", version: "v1", playbook: "general",
    instruction: "Note when the failure happens in the cycle (for example: while filling, washing, draining, or spinning).",
    categories: null, preconditions: ["appliance_category"], hazardExclusions: [],
    source: "playbook:general:v1", expectedObservation: "timing description",
    stopConditions: "Do not start extra cycles to test; describe the last run only.",
    reviewStatus: "approved",
  },
  {
    action_id: "act_check_drain_visible", version: "v1", playbook: "general",
    instruction: "Look (without touching wiring or hoses) for standing water in the drum or tub.",
    categories: ["washer", "washing_machine", "dishwasher"], preconditions: ["appliance_category"],
    hazardExclusions: ["water_electric", "shock", "sparking"],
    source: "playbook:washer_dw:v1", expectedObservation: "standing water yes/no",
    stopConditions: "Stop if water is near outlets or wiring.",
    reviewStatus: "approved",
  },
];

export function findQuestion(id: string): Question | undefined {
  return QUESTIONS.find((q) => q.id === id);
}

export function findAction(id: string): CustomerAction | undefined {
  return CUSTOMER_ACTIONS.find((a) => a.action_id === id && a.reviewStatus === "approved");
}

// Pick the next allowed question given collected fact keys and asked question ids.
export function nextQuestion(args: {
  factKeys: Set<string>;
  askedIds: Set<string>;
  category: string | null;
  hazardTypes: string[];
  diagnosticCount: number;
  playbookVersions?: Record<string, string>;
}): Question | null {
  if (args.diagnosticCount >= 10) return null;
  const versionOk = (q: Question): boolean => {
    if (!args.playbookVersions) return true;
    const want = args.playbookVersions[q.playbook];
    if (!want) return true; // tenant without that playbook key: allow
    return want === q.version;
  };
  // Fixed intake spine first.
  const spine = ["q_category", "q_problem", "q_zip", "q_brand", "q_model", "q_age"];
  for (const id of spine) {
    const q = findQuestion(id)!;
    if (args.askedIds.has(id)) continue;
    if (q.factKey && args.factKeys.has(q.factKey)) continue;
    if (!versionOk(q)) continue;
    if (q.exclusions.some((e) => args.hazardTypes.includes(e))) continue;
    return q;
  }
  // Category follow-ups.
  for (const q of QUESTIONS) {
    if (args.askedIds.has(q.id)) continue;
    if (q.factKey && args.factKeys.has(q.factKey)) continue;
    if (q.categories && args.category && !q.categories.includes(args.category)) continue;
    if (q.categories && !args.category) continue;
    if (q.preconditions.some((p) => !args.factKeys.has(p))) continue;
    if (q.exclusions.some((e) => args.hazardTypes.includes(e))) continue;
    if (!versionOk(q)) continue;
    // Skip contact questions until diagnostics done or handoff requested (handled by caller).
    if (["q_name", "q_contact", "q_window"].includes(q.id)) continue;
    return q;
  }
  // Contact spine.
  for (const id of ["q_name", "q_contact", "q_window"]) {
    const q = findQuestion(id)!;
    if (args.askedIds.has(id)) continue;
    if (q.factKey && args.factKeys.has(q.factKey)) continue;
    if (!versionOk(q)) continue;
    return q;
  }
  return null;
}
