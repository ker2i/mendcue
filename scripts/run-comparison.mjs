// Private complete-brief, fixed-input comparison. No repair outcomes are loaded.
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MetaProvider } from '../dist/integrations/meta/meta.js';
import { prepareComparison } from '../dist/evaluation/product-comparison.js';
import { tenantConfigSchema } from '../dist/tenant-config.js';
const [file, root=process.env.PRIVATE_ARTIFACT_ROOT??'data/comparison'] = process.argv.slice(2);
if(!file)throw Error('Usage: GLOBAL_AI_SPEND_LIMIT=<cap> node scripts/run-comparison.mjs private-product-case.json [private output root]');
if(!process.env.GLOBAL_AI_SPEND_LIMIT||!process.env.MODEL_API_KEY)throw Error('An explicit spend cap and server-side Meta key are required');
const document=z.object({id:z.string(),tenantId:z.string().nullable(),visibility:z.enum(['shared','tenant_private']),publisher:z.string(),usageBasis:z.string().min(1),sourceUrl:z.string().url().nullable(),documentType:z.string(),title:z.string(),language:z.string(),brand:z.string().nullable(),explicitModels:z.array(z.string()),explicitFamilies:z.array(z.string()),retrievedAt:z.string().datetime(),hash:z.string().min(1),version:z.string().min(1),reviewStatus:z.literal('approved'),reviewedBy:z.string().min(1)});
const chunk=z.object({id:z.string(),documentId:z.string(),tenantId:z.string().nullable(),visibility:z.enum(['shared','tenant_private']),version:z.string(),pageIndex:z.number().int().nonnegative(),pageLabel:z.string().nullable(),text:z.string().max(20000),applicability:z.object({models:z.array(z.string()),families:z.array(z.string()),categories:z.array(z.string())})});
const schema=z.object({kind:z.enum(['synthetic','real_anonymized']),tenant:tenantConfigSchema,
 facts:z.array(z.object({id:z.string(),key:z.string(),value:z.union([z.string().max(2000),z.number(),z.boolean(),z.null()])})).max(80),documents:z.array(document).max(12),chunks:z.array(chunk).max(40),images:z.array(z.string()).max(1).default([])});
if(statSync(file).size>1024*1024)throw Error('Input JSON exceeds 1MB');
const sample=schema.parse(JSON.parse(readFileSync(file,'utf8')));
if(sample.kind==='real_anonymized'&&sample.documents.some(d=>d.reviewedBy.startsWith('example-content')))throw Error('Example documents do not establish real reviewed coverage');
const images=sample.images.map(path=>{const full=resolve(dirname(file),path);if(statSync(full).size>8*1024*1024)throw Error('Image exceeds upload limit');return readFileSync(full);});
let activeSystem=null;const rawOutputs={};
const provider=new MetaProvider(process.env.MODEL_API_KEY,(operation,raw)=>{rawOutputs[activeSystem]={operation,raw};});
const prepared=await prepareComparison({...sample,images},provider);
const baseline=readFileSync('docs/baseline-prompt.md','utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
const run={id:randomUUID(),kind:sample.kind,comparison:'A_fixed_input_complete_brief',model:'muse-spark-1.3',createdAt:new Date().toISOString(),baselinePromptHash:hash(baseline),
 versions:Object.fromEntries(['src/domain/intake.ts','src/domain/brief.ts','src/domain/brief-review.ts','src/integrations/meta/meta.ts','src/evaluation/product-comparison.ts'].map(p=>[p,hash(readFileSync(p))])),
 imageHashes:images.map(hash),input:prepared.input,outputs:{},order:randomInt(2)?['baseline','mendcue']:['mendcue','baseline']};
const output=resolve(root,sample.tenant.id);mkdirSync(output,{recursive:true,mode:0o700});
const save=()=>writeFileSync(`${output}/${run.id}.private.json`,JSON.stringify(run,null,2),{mode:0o600});save();
for(const system of run.order){
 activeSystem=system;const start=Date.now();
 try{run.outputs[system]=system==='mendcue'?await prepared.runProduct():{status:'ok',brief:await provider.draftServiceBrief(prepared.input,baseline)};}
 catch{run.outputs[system]={status:'failed',reason:'Provider/budget/schema failure; inspect private ledger'};}
 run.outputs[system].rawOutput=rawOutputs[system]??null;
 run.outputs[system].latencyMs=Date.now()-start;
 try{const ledger=JSON.parse(readFileSync(process.env.META_USAGE_LEDGER??'data/meta-usage.json','utf8'));run.outputs[system].usage=ledger.filter(r=>r.caseId===prepared.input.caseId).slice(-1)[0]??null;}catch{run.outputs[system].usage=null;}
 save();
}
const order=randomInt(2)?['baseline','mendcue']:['mendcue','baseline'];
const blind={runId:run.id,kind:run.kind,comparison:run.comparison,outputs:order.map((s,i)=>({label:i?'B':'A',status:run.outputs[s].status,brief:run.outputs[s].brief??null})),grades:[]};
writeFileSync(`${output}/${run.id}.blind.json`,JSON.stringify(blind,null,2),{mode:0o600});
writeFileSync(`${output}/${run.id}.key.json`,JSON.stringify({A:order[0],B:order[1]}),{mode:0o600});
console.log(`Saved private complete briefs under ${output}; no pilot results or adaptive-questioning benefit measured.`);
