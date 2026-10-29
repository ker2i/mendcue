// Shared file ledger for a single-host web + worker deployment. Fail closed on
// lock contention, uncertain usage, missing prices, or a spent reservation.
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { ModelFailure } from './provider.js';
export interface UsageRecord {
  caseId: string; model: string; promptVersion: string; schemaVersion: string;
  latencyMs: number; inputTokens: number | null; outputTokens: number | null;
  inputUsdPerMillion: number; outputUsdPerMillion: number; priceEffectiveDate: string;
  estimatedUsd: number | null; success: boolean; recordedAt: string;
}
export async function budgetedRequest<T>(args: {
  caseId: string; model: string; bytes: number; request: () => Promise<T>;
}): Promise<T> {
  const path = process.env.META_USAGE_LEDGER ?? 'data/meta-usage.json';
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let fd: number;
  try { fd = openSync(path + '.lock', 'wx', 0o600); }
  catch { throw new ModelFailure('Model concurrency limit or ledger lock active'); }
  const start = Date.now();
  try {
    const cap = Number(process.env.GLOBAL_AI_SPEND_LIMIT ?? 2);
    const inputPrice = Number(process.env.META_INPUT_USD_PER_MILLION ?? 1.25);
    const outputPrice = Number(process.env.META_OUTPUT_USD_PER_MILLION ?? 4.25);
    if (![cap,inputPrice,outputPrice].every(n=>Number.isFinite(n)&&n>0)) throw new ModelFailure('Invalid spending configuration');
    // Conservative byte-based text estimate; image billing must be configured
    // with a reviewed upper reservation before live vision is enabled.
    const reserve = (args.bytes + 8192) * inputPrice / 1e6 + 2048 * outputPrice / 1e6;
    let records: UsageRecord[] = [];
    try { records = JSON.parse(readFileSync(path,'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new ModelFailure('Unreadable usage ledger'); }
    const caseSpent = records.filter(r=>r.caseId===args.caseId).reduce((sum,r)=>sum+(r.estimatedUsd ?? cap),0);
    const caseLimit = Number(process.env.META_CASE_USD_LIMIT ?? 0.5);
    const recent = records.filter(r=>Date.parse(r.recordedAt)>Date.now()-60_000).length;
    if (!Number.isFinite(caseLimit) || caseLimit <= 0 || caseSpent + reserve > caseLimit || recent >= 30) throw new ModelFailure('Model case budget or rate limit reached');
    const spent = records.reduce((sum,r)=>sum+(r.estimatedUsd ?? cap),0);
    if (records.some(r=>r.estimatedUsd === null) || spent + reserve > cap ||
        records.filter(r=>r.caseId===args.caseId).length >= Number(process.env.META_CASE_CALL_LIMIT ?? 30)) throw new ModelFailure('Model budget or per-case limit reached');
    const persist = () => { writeFileSync(path+'.tmp',JSON.stringify(records,null,2),{mode:0o600}); renameSync(path+'.tmp',path); };
    // Persist unknown before network access: a crash cannot silently lose spend.
    const record: UsageRecord = { caseId:args.caseId,model:args.model,promptVersion:'intake-v2',schemaVersion:'v1',inputUsdPerMillion:inputPrice,outputUsdPerMillion:outputPrice,priceEffectiveDate:process.env.META_PRICE_EFFECTIVE_DATE ?? '2026-10-29',latencyMs:0,inputTokens:null,outputTokens:null,estimatedUsd:null,success:false,recordedAt:new Date().toISOString() };
    records.push(record); persist();
    try {
      const response = await args.request();
      const usage = (response as {usage?:{prompt_tokens?:number;completion_tokens?:number}}).usage;
      if (Number.isInteger(usage?.prompt_tokens) && usage!.prompt_tokens! >= 0 && Number.isInteger(usage?.completion_tokens) && usage!.completion_tokens! >= 0) {
        record.inputTokens=usage!.prompt_tokens!;record.outputTokens=usage!.completion_tokens!;
        record.estimatedUsd=(record.inputTokens*inputPrice+record.outputTokens*outputPrice)/1e6;
      }
      record.success=true; return response;
    } finally { record.latencyMs=Date.now()-start;persist(); }
  } catch (e) {
    if (e instanceof ModelFailure) throw e;
    throw new ModelFailure("Model request or usage ledger failed");
  } finally { closeSync(fd);unlinkSync(path+'.lock'); }
}
