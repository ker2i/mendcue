// Seed: two clearly labeled demonstration tenants, approved playbook knowledge,
// demo staff users, demo service credentials. No real business details.
import type { TenantConfig } from "../domain/types.js";
import type { KnowledgeChunk, KnowledgeDocument } from "../domain/knowledge.js";
import { openingMessageFor } from "../domain/tenancy.js";

export const DEMO_TENANT_A_SLUG = "demo-phoenix-appliance";
export const DEMO_TENANT_B_SLUG = "demo-harbor-warranty";

export function demoTenants(): TenantConfig[] {
  const a: TenantConfig = {
    id: "tnt_demo_phoenix",
    slug: DEMO_TENANT_A_SLUG,
    name: "Demo Phoenix Appliance Service",
    demoLabel: "DEMONSTRATION BUSINESS — not a real company",
    orgType: "solo_repair",
    branding: { primaryColor: "#0b5fff", logoUrl: null },
    contact: { email: null, phone: null },
    timezone: "America/Phoenix",
    languages: ["en"],
    allowedOrigins: ["http://localhost:3100", "http://127.0.0.1:3100"],
    publicKey: "pk_demo_phoenix_001",
    categories: ["refrigerator", "freezer", "washer", "dishwasher", "oven", "dryer", "other"],
    detailedCategories: ["refrigerator", "freezer", "washer", "dishwasher"],
    serviceZips: ["85001", "85002", "85003", "85004", "85006", "85008", "85012", "85014", "85015", "85016"],
    requireStreetAddress: false,
    requiredFields: ["appliance_category", "problem_description", "service_zip", "contact_channel"],
    playbookVersions: { refrigerator: "v1", washer: "v1", dishwasher: "v1", general: "v1" },
    routing: { destination: "owner-inbox", queue: "Owner's inbox" },
    notifications: { emailEnabled: false, emailTo: null },
    retention: { draftDays: 7, closedDays: 90, logDays: 14 },
    privacyText: "Demo intake. Do not submit real personal data. Intake is stored for the demonstration only.",
    openingMessage: openingMessageFor("Demo Phoenix Appliance Service (DEMO)"),
    gasUtilityContact: "Southwest Gas emergency line (configure per service area)",
    featureFlags: { photos: true, knowledge: true, recall: false },
  };
  const b: TenantConfig = {
    id: "tnt_demo_harbor",
    slug: DEMO_TENANT_B_SLUG,
    name: "Demo Harbor Warranty Co.",
    demoLabel: "DEMONSTRATION BUSINESS — not a real company",
    orgType: "home_warranty",
    branding: { primaryColor: "#0e7c4b", logoUrl: null },
    contact: { email: null, phone: null },
    timezone: "America/New_York",
    languages: ["en"],
    allowedOrigins: ["http://localhost:3101", "http://127.0.0.1:3101"],
    publicKey: "pk_demo_harbor_001",
    categories: ["refrigerator", "washer", "dishwasher", "oven", "dryer", "other"],
    detailedCategories: ["refrigerator", "washer", "dishwasher"],
    serviceZips: null, // unrestricted demo intake
    requireStreetAddress: false,
    requiredFields: ["appliance_category", "problem_description", "contact_channel"],
    playbookVersions: { refrigerator: "v1", washer: "v1", dishwasher: "v1", general: "v1" },
    routing: { destination: "intake-queue", queue: "Intake queue" },
    notifications: { emailEnabled: false, emailTo: null },
    retention: { draftDays: 7, closedDays: 90, logDays: 14 },
    privacyText: "Demo intake. Do not submit real personal data.",
    openingMessage: openingMessageFor("Demo Harbor Warranty Co. (DEMO)"),
    gasUtilityContact: "local gas utility emergency line (configure per service area)",
    featureFlags: { photos: true, knowledge: true, recall: false },
  };
  return [a, b];
}

// Small reviewed manual collection. These are technician-approved GENERAL playbook
// excerpts written for the demo — not manufacturer manuals. Real manuals are added
// through the documented ingestion flow with source URLs and page citations.
export function demoDocuments(): KnowledgeDocument[] {
  const base = {
    publisher: "Demo playbook editors (technician-approved general guidance)",
    sourceUrl: null,
    language: "en",
    retrievedAt: "2026-10-29T00:00:00Z",
    reviewStatus: "approved" as const,
    reviewedBy: "demo-reviewer",
  };
  return [
    {
      id: "doc_washer_general", tenantId: null, visibility: "shared",
      documentType: "category_playbook", title: "Washer intake playbook (general, approved)",
      brand: null, explicitModels: [], explicitFamilies: [],
      hash: "demo-washer-v1", version: "v1", ...base,
    },
    {
      id: "doc_fridge_general", tenantId: null, visibility: "shared",
      documentType: "category_playbook", title: "Refrigerator intake playbook (general, approved)",
      brand: null, explicitModels: [], explicitFamilies: [],
      hash: "demo-fridge-v1", version: "v1", ...base,
    },
    {
      id: "doc_dw_general", tenantId: null, visibility: "shared",
      documentType: "category_playbook", title: "Dishwasher intake playbook (general, approved)",
      brand: null, explicitModels: [], explicitFamilies: [],
      hash: "demo-dw-v1", version: "v1", ...base,
    },
  ];
}

export function demoChunks(): KnowledgeChunk[] {
  return [
    {
      id: "chk_washer_oe", documentId: "doc_washer_general", tenantId: null,
      visibility: "shared", version: "v1", pageIndex: 0, pageLabel: "p.1",
      text: "Washer intake: when the customer reports the machine fills then stops with water left in the drum, record the exact displayed code verbatim, the cycle stage, and whether the drum drained. Do not interpret the code for a specific model without applicable documentation. Ask about load size and when the failure occurs.",
      applicability: { models: [], families: [], categories: ["washer", "washing_machine", "general"] },
    },
    {
      id: "chk_washer_drain", documentId: "doc_washer_general", tenantId: null,
      visibility: "shared", version: "v1", pageIndex: 0, pageLabel: "p.1",
      text: "Washer intake: standing water after a cycle points intake toward drain-path questions (drain observation, failure stage, load size). Customer checks are limited to safe observations: reading the visible display and describing timing. Never direct the customer to open panels or handle hoses with water near wiring.",
      applicability: { models: [], families: [], categories: ["washer", "washing_machine"] },
    },
    {
      id: "chk_fridge_cool", documentId: "doc_fridge_general", tenantId: null,
      visibility: "shared", version: "v1", pageIndex: 0, pageLabel: "p.1",
      text: "Refrigerator intake: establish which compartment is affected (fridge, freezer, or both), any display readings verbatim, fan/compressor sounds, and visible water or ice without moving the appliance. Collect timeline and recent changes.",
      applicability: { models: [], families: [], categories: ["refrigerator", "freezer"] },
    },
    {
      id: "chk_fridge_safety", documentId: "doc_fridge_general", tenantId: null,
      visibility: "shared", version: "v1", pageIndex: 0, pageLabel: "p.2",
      text: "Refrigerator safety: reports of sparking, shock, burning smell, or water near electrical parts require immediate escalation. Never ask the customer to move the appliance or remove panels.",
      applicability: { models: [], families: [], categories: ["refrigerator", "freezer", "general"] },
    },
    {
      id: "chk_dw_drain", documentId: "doc_dw_general", tenantId: null,
      visibility: "shared", version: "v1", pageIndex: 0, pageLabel: "p.1",
      text: "Dishwasher intake: record the cycle stage where the problem occurs, any displayed code verbatim, and whether standing water remains in the tub. Ask about recent filter cleaning only as a reported fact, not as a directed repair.",
      applicability: { models: [], families: [], categories: ["dishwasher"] },
    },
  ];
}

export const DEMO_STAFF = [
  { tenantSlug: DEMO_TENANT_A_SLUG, email: "tech@demo-phoenix.invalid", password: "demo-tech-1234", role: "technician" as const, name: "Demo Tech" },
  { tenantSlug: DEMO_TENANT_B_SLUG, email: "dispatch@demo-harbor.invalid", password: "demo-dispatch-1234", role: "dispatcher" as const, name: "Demo Dispatcher" },
];

export const DEMO_SERVICE_KEY_A = "sk_demo_phoenix_001_SECRET";
