import { it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { budgetedRequest, requestReservation } from '../src/integrations/meta/usage.js';
import { MetaProvider } from '../src/integrations/meta/meta.js';
const roots:string[]=[];
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function ledger() { const root=mkdtempSync(join(tmpdir(),'mendcue-usage-'));roots.push(root);const path=join(root,'ledger.json');vi.stubEnv('META_USAGE_LEDGER',path);vi.stubEnv('GLOBAL_AI_SPEND_LIMIT','2');return path; }
it('records measured tokens and estimated cost without customer content', async()=>{
  const path=ledger();await budgetedRequest({caseId:'case',model:'muse-spark-1.3',bytes:100,request:async()=>({usage:{prompt_tokens:100,completion_tokens:10}})});
  expect(JSON.parse(readFileSync(path,'utf8'))[0]).toMatchObject({inputTokens:100,outputTokens:10,success:true});
});
it('a timeout retains its reservation and another customer can still use the provider',async()=>{
  const path=ledger();await expect(budgetedRequest({caseId:'case',model:'muse-spark-1.3',bytes:100,request:async()=>{throw new Error('timeout');}})).rejects.toThrow();
  expect(JSON.parse(readFileSync(path,'utf8'))[0]).toMatchObject({estimatedUsd:requestReservation(100,1.25,4.25),accounting:'reserved',success:false});
  const request=vi.fn(async()=>({usage:{prompt_tokens:100,completion_tokens:10}}));
  await budgetedRequest({caseId:'unrelated',model:'muse-spark-1.3',bytes:100,request});expect(request).toHaveBeenCalledOnce();
});
it('repeated failures consume the allowance and stop before another network call',async()=>{
  ledger();const reserve=requestReservation(100,1.25,4.25);vi.stubEnv('GLOBAL_AI_SPEND_LIMIT',String(reserve*2.5));
  const request=vi.fn(async()=>{throw new Error('lost response');});
  for(const caseId of ['first','second','third'])await expect(budgetedRequest({caseId,model:'muse-spark-1.3',bytes:100,request})).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(2);
});
it('missing token counts retain the charge without blocking unrelated customers',async()=>{
  const path=ledger();
  await budgetedRequest({caseId:'first',model:'muse-spark-1.3',bytes:100,request:async()=>({choices:[]})});
  expect(JSON.parse(readFileSync(path,'utf8'))[0]).toMatchObject({success:true,accounting:'reserved',estimatedUsd:requestReservation(100,1.25,4.25)});
  await budgetedRequest({caseId:'second',model:'muse-spark-1.3',bytes:100,request:async()=>({usage:{prompt_tokens:100,completion_tokens:10}})});
});
it('legacy unbounded usage and malformed ledgers still fail closed',async()=>{
  const path=ledger(),request=vi.fn();
  writeFileSync(path,JSON.stringify([{caseId:'old',recordedAt:new Date().toISOString(),estimatedUsd:null}]));
  await expect(budgetedRequest({caseId:'new',model:'muse-spark-1.3',bytes:100,request})).rejects.toThrow('reconciliation');
  writeFileSync(path,JSON.stringify([{caseId:'old',recordedAt:new Date().toISOString(),estimatedUsd:-1}]));
  await expect(budgetedRequest({caseId:'new',model:'muse-spark-1.3',bytes:100,request})).rejects.toThrow('Invalid usage ledger');
  expect(request).not.toHaveBeenCalled();
});
it('retains a crash reservation already persisted before network access',async()=>{
  const path=ledger();
  await budgetedRequest({caseId:'first',model:'muse-spark-1.3',bytes:100,request:async()=>{
    expect(JSON.parse(readFileSync(path,'utf8'))[0]).toMatchObject({accounting:'reserved',estimatedUsd:requestReservation(100,1.25,4.25),success:false});
    return {usage:{prompt_tokens:100,completion_tokens:10}};
  }});
});
it('captures provider status and identifiers without logging echoed private messages',async()=>{
  const path=ledger();
  vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify({error:{code:'rate_limit_exceeded',message:'PRIVATE CUSTOMER AND SECRET'}}),{status:429,headers:{'x-request-id':'request-123'}}));
  const provider=new MetaProvider('private-test-key');
  await expect(provider.extractIntakeTurn({tenantId:'t',caseId:'case',messageId:'m',messageText:'PRIVATE CUSTOMER',knownFacts:[],askedQuestionIds:[],allowedQuestionIds:[],allowedActionIds:[],category:null,activeQuestion:null,recentMessages:[]})).rejects.toMatchObject({details:{kind:'http',status:429,code:'rate_limit_exceeded',requestId:'request-123'}});
  const text=readFileSync(path,'utf8');expect(text).not.toContain('PRIVATE');expect(text).not.toContain('private-test-key');
  expect(JSON.parse(text)[0]).toMatchObject({accounting:'reserved',failure:{kind:'http',status:429,code:'rate_limit_exceeded',requestId:'request-123'}});
});
it('stops before network access when reservation exceeds cap',async()=>{
  ledger();vi.stubEnv('GLOBAL_AI_SPEND_LIMIT','0.001');const request=vi.fn();
  await expect(budgetedRequest({caseId:'case',model:'muse-spark-1.3',bytes:100,request})).rejects.toThrow('budget');expect(request).not.toHaveBeenCalled();
});
