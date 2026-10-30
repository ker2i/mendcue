// Private operator CLI, fixed-input comparison A. No public model endpoint.
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MetaProvider } from '../dist/integrations/meta/meta.js';
const [file, output='data/comparison'] = process.argv.slice(2);
const publicInput = z.object({
  tenantId:z.string(), caseId:z.string(),
  facts:z.array(z.object({id:z.string(),key:z.string(),value:z.unknown()})).max(80),
  chunks:z.array(z.object({id:z.string(),documentId:z.string(),page:z.string().nullable(),text:z.string().max(20000)})).max(8),
  knowledgeLevel:z.enum(['exact_model','verified_family','category_only','unknown']),
});
const schema=z.object({kind:z.enum(['synthetic','real_anonymized']),input:publicInput,images:z.array(z.string()).default([])});
if(!file) throw new Error('Usage: GLOBAL_AI_SPEND_LIMIT=<explicit cap> node scripts/run-comparison.mjs case-input.json [private output directory]');
const sample=schema.parse(JSON.parse(readFileSync(file,'utf8')));
if(sample.images.length) throw new Error('Image parity is not implemented in this runner; do not omit images to claim an image comparison');
if(!process.env.GLOBAL_AI_SPEND_LIMIT || !process.env.MODEL_API_KEY) throw new Error('An explicit comparison cap and server-side Meta key are required');
const baseline=readFileSync('docs/baseline-prompt.md','utf8');
const provider=new MetaProvider(process.env.MODEL_API_KEY);
const run={id:randomUUID(),kind:sample.kind,comparison:'A_fixed_input_text',model:'muse-spark-1.3',baselinePromptHash:createHash('sha256').update(baseline).digest('hex'),createdAt:new Date().toISOString(),input:sample.input,outputs:{},order:randomInt(2)?['baseline','mendcue']:['mendcue','baseline']};
mkdirSync(output,{recursive:true,mode:0o700});
const save=()=>writeFileSync(`${output}/${run.id}.private.json`,JSON.stringify(run,null,2),{mode:0o600});
save();
// Persist partial failures and raw outputs; a failed first request can exhaust
// the uncertainty budget and correctly prevent the second from starting.
for(const system of run.order) {
  try {run.outputs[system]={status:'ok',assessment:await provider.assessCase(sample.input,system==='baseline'?baseline:undefined)};}
  catch {run.outputs[system]={status:'failed',reason:'Provider/budget/schema failure; inspect private usage ledger'};}
  save();
}
const blindOrder=randomInt(2)?['baseline','mendcue']:['mendcue','baseline'];
const blind={runId:run.id,kind:run.kind,comparison:run.comparison,outputs:blindOrder.map((system,i)=>({label:i?'B':'A',...run.outputs[system]})),grades:[]};
writeFileSync(`${output}/${run.id}.blind.json`,JSON.stringify(blind,null,2),{mode:0o600});
writeFileSync(`${output}/${run.id}.key.json`,JSON.stringify({A:blindOrder[0],B:blindOrder[1]}),{mode:0o600});
console.log(`Saved private paired results and blinded grading artifact in ${output}; no quality or savings claim computed.`);
