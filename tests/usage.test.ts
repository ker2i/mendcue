import { it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { budgetedRequest } from '../src/integrations/meta/usage.js';
afterEach(()=>vi.unstubAllEnvs());
function ledger() { const path=join(mkdtempSync(join(tmpdir(),'mendcue-usage-')),'ledger.json');vi.stubEnv('META_USAGE_LEDGER',path);vi.stubEnv('GLOBAL_AI_SPEND_LIMIT','2');return path; }
it('records measured tokens and estimated cost without customer content', async()=>{
  const path=ledger();await budgetedRequest({caseId:'case',model:'muse-spark-1.3',bytes:100,request:async()=>({usage:{prompt_tokens:100,completion_tokens:10}})});
  expect(JSON.parse(readFileSync(path,'utf8'))[0]).toMatchObject({inputTokens:100,outputTokens:10,success:true});
});
it('unknown usage blocks further spending, including failed requests',async()=>{
  const path=ledger();await expect(budgetedRequest({caseId:'case',model:'muse-spark-1.3',bytes:100,request:async()=>{throw new Error('timeout');}})).rejects.toThrow();
  expect(JSON.parse(readFileSync(path,'utf8'))[0].estimatedUsd).toBeNull();
  const request=vi.fn();await expect(budgetedRequest({caseId:'case',model:'muse-spark-1.3',bytes:100,request})).rejects.toThrow('budget');expect(request).not.toHaveBeenCalled();
});
it('stops before network access when reservation exceeds cap',async()=>{
  ledger();vi.stubEnv('GLOBAL_AI_SPEND_LIMIT','0.001');const request=vi.fn();
  await expect(budgetedRequest({caseId:'case',model:'muse-spark-1.3',bytes:100,request})).rejects.toThrow('budget');expect(request).not.toHaveBeenCalled();
});
