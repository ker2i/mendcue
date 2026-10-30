import { isAllowedKey } from "../domain/facts.js";
// Fixed-input experiment only; complete product briefs use the real submit path.
import { randomUUID } from "node:crypto";
import { MemoryStore } from "../db/memory.js";
import type { TenantConfig, CaseFact, CaseRecord } from "../domain/types.js";
import type { KnowledgeDocument, KnowledgeChunk } from "../domain/knowledge.js";
import type { AssessmentInput, AssessmentResult, ModelProvider } from "../integrations/meta/provider.js";
import { createCase, submitCase } from "../domain/intake.js";
import { handleHazardTurn } from "../domain/intake.js";
import { createHash } from "node:crypto";
import { screenHazards } from "../domain/safety.js";
import { briefForReview } from "../domain/brief-review.js";
import { sanitizeImage } from "../integrations/storage/images.js";

export interface ProductSample {
  tenant:TenantConfig;documents:KnowledgeDocument[];chunks:KnowledgeChunk[];
  facts:Array<{id:string;key:string;value:CaseFact["value"]}>;images:Buffer[];
}
export async function prepareComparison(sample:ProductSample, provider:ModelProvider){
  if(sample.facts.some(f=>!isAllowedKey(f.key)) || new Set(sample.facts.map(f=>f.key)).size!==sample.facts.length)throw new Error("Use unique intake fact keys; repair outcomes are withheld");
  if(sample.images.length>1)throw new Error("This experiment supports one equivalent label image per case");
  const caseId=randomUUID();
  const images=await Promise.all(sample.images.map(sanitizeImage));
  const setup=async(model:ModelProvider)=>{
    const store=new MemoryStore();
    const tenant={...sample.tenant,notifications:{emailEnabled:false,emailTo:null}};
    await store.saveTenant(tenant);
    for(const d of sample.documents){if(d.visibility!=="shared"&&d.tenantId!==tenant.id)throw new Error("Document tenant mismatch");await store.saveDocument(d);}
    for(const chunk of sample.chunks)await store.saveChunk(chunk);
    const deps={store,provider:model,storageGet:async(key:string)=>images[Number(key)]??null};
    const created=await createCase(deps,tenant,"hosted");
    store.cases.delete(created.id);
    const hazard=screenHazards(sample.facts.map(f=>String(f.value??"")).join(" "));
    const c:CaseRecord={...created,id:caseId,conversationPhase:"review",safetyStatus:"unchecked"};
    await store.createCase(c);
    if(hazard.length)await handleHazardTurn(deps,tenant,c,hazard);
    for(const f of sample.facts)await store.addFact({...f,caseId,tenantId:tenant.id,status:f.key==="model_confirmed"&&f.value===true?"confirmed":"reported",sourceMessageId:null,sourceAttachmentId:null,certainty:"explicit",supersedesId:null,confirmedBy:null,confirmedAt:null,createdAt:c.createdAt});
    for(let i=0;i<images.length;i++)await store.addAttachment({id:`image-${i}`,caseId,tenantId:tenant.id,kind:"label_photo",mimeType:"image/webp",sizeBytes:images[i].length,storageKey:String(i),sha256:createHash("sha256").update(images[i]).digest("hex"),rawOcrText:null,createdAt:c.createdAt});
    return {store,tenant,deps,c};
  };
  let input:AssessmentInput|undefined;
  const capture:ModelProvider={mode:provider.mode,extractIntakeTurn:provider.extractIntakeTurn.bind(provider),extractApplianceLabel:provider.extractApplianceLabel.bind(provider),assessCase:async i=>{input=i;return {hypotheses:[],recommendedFollowUp:"Preflight only"};}};
  const preflight=await setup(capture);
  await submitCase(preflight.deps,preflight.tenant,caseId,{acknowledgeIncomplete:true});
  if(!input)throw new Error("Could not prepare equivalent assessment inputs; image processing may have failed");
  return {input,runProduct:async()=>{
    let raw:AssessmentResult|undefined;
    const recording:ModelProvider={...capture,assessCase:async i=>{raw=await provider.assessCase(i);return raw;}};
    const {deps,tenant,store}=await setup(recording);
    const result=await submitCase(deps,tenant,caseId,{acknowledgeIncomplete:true});
    const snapshot=(await store.listHandoffs(tenant.id,caseId))[0].snapshot;
    return {status:result.assessment.status==="ok"?"ok":"failed",brief:briefForReview(snapshot),snapshot,rawAssessment:raw};
  }};
}
