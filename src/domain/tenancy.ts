// Tenant defaults per organization type. Types change wording/routing, never implementation.
import type { OrgType } from "./types.js";

export const ORG_DEFAULTS: Record<
  OrgType,
  { cta: string; queue: string; referenceLabel: string; reviewer: string; integration: string }
> = {
  solo_repair: {
    cta: "Request appliance service",
    queue: "Owner's inbox",
    referenceLabel: "Existing job number",
    reviewer: "Technician",
    integration: "Dashboard/email",
  },
  repair_company: {
    cta: "Start a service request",
    queue: "Dispatch queue",
    referenceLabel: "Work order number",
    reviewer: "Dispatcher or technician",
    integration: "Dispatch or CRM",
  },
  home_warranty: {
    cta: "Start a service request",
    queue: "Intake queue",
    referenceLabel: "Contract / claim reference",
    reviewer: "Handler or assigned service provider",
    integration: "Claims platform",
  },
  insurance: {
    cta: "Report an appliance issue",
    queue: "Intake or claims queue",
    referenceLabel: "External claim reference",
    reviewer: "Handler or assigned service provider",
    integration: "Claims platform",
  },
};

export function openingMessageFor(businessName: string): string {
  return (
    `I'm the AI intake assistant for ${businessName}. ` +
    `I'll collect details about your appliance problem and prepare them for the service team. ` +
    `You can ask for a person at any time.`
  );
}
