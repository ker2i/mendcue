import { z } from "zod";
// Same human grading/display fields for a submitted brief and a general assistant.
export const briefReviewSchema=z.object({
  identity:z.string().max(1600),complaint:z.string().max(2500),safety:z.string().max(1600),
  observations:z.array(z.string().max(1200)).max(80),issueAreas:z.array(z.string().max(1600)).max(3),
  missingInformation:z.array(z.string().max(500)).max(40),followup:z.string().max(2000),
  contact:z.string().max(1200),documentation:z.array(z.string().max(2000)).max(8),
});
export type BriefReview=z.infer<typeof briefReviewSchema>;
export function briefForReview(snapshot: Record<string,unknown>): BriefReview {
  const a=snapshot.appliance as Record<string,unknown>;
  const facts=snapshot.facts as Array<{key:string;value:unknown;certainty:string;source_attachment:string|null}>;
  return {
    identity:`${a.category??"Unknown appliance"}; brand ${a.brand??"unknown"}; model ${a.model_raw??a.model??"unknown"}; serial ${a.serial??"unknown"}; customer confirmed: ${a.model_confirmed===true}; documentation: ${snapshot.knowledge_level}`,
    complaint:String(snapshot.complaint??"Not reported"),safety:JSON.stringify(snapshot.safety),
    observations:facts.map(f=>`${f.key}: ${String(f.value)} (${f.certainty}${f.source_attachment?", photo extracted":""})`),
    issueAreas:(snapshot.hypotheses as Array<{issueArea:string;limitations:string[]}>).map(h=>`${h.issueArea}. ${h.limitations.join(" ")}`),
    missingInformation:snapshot.missing_information as string[],followup:String(snapshot.recommended_follow_up),
    contact:JSON.stringify({contact:snapshot.contact,service_zip:snapshot.service_zip,preferred_window:snapshot.preferred_window}),
    documentation:(snapshot.citations as Array<{title:string;documentVersion:string;pdfPageIndex:number|null;excerpt:string;applicabilityBasis:string}>).map(c=>`${c.title}, version ${c.documentVersion}, PDF page ${c.pdfPageIndex===null?"unknown":c.pdfPageIndex+1}; ${c.applicabilityBasis}: ${c.excerpt.slice(0,1000)}`),
  };
}
