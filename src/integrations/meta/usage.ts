// Shared file ledger for a single-host web + worker deployment. Fail closed on
// lock contention, uncertain usage, missing prices, or a spent reservation.
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ModelFailure, type ModelFailureDetails } from './provider.js';
export const MODEL_MAX_OUTPUT_TOKENS = 2048;
export function requestReservation(bytes: number, inputPrice: number, outputPrice: number): number {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || ![inputPrice, outputPrice].every(n => Number.isFinite(n) && n > 0)) {
    throw new ModelFailure('Invalid request reservation');
  }
  return (bytes + 8192) * inputPrice / 1e6 + MODEL_MAX_OUTPUT_TOKENS * outputPrice / 1e6;
}
export interface UsageRecord {
  caseId: string; model: string; promptVersion: string; schemaVersion: string;
  latencyMs: number; inputTokens: number | null; outputTokens: number | null;
  inputUsdPerMillion: number; outputUsdPerMillion: number; priceEffectiveDate: string;
  estimatedUsd: number | null; success: boolean; recordedAt: string;
  id?: string; requestBytes?: number; reservedUsd?: number;
  accounting?: 'reserved' | 'measured'; failure?: ModelFailureDetails;
  reconciliation?: { at: string; basis: string; previousEstimatedUsd: null; maxRequestBytes: number };
}
export function readUsageRecords(path: string): UsageRecord[] {
  let rows: unknown;
  try { rows = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw new ModelFailure('Unreadable usage ledger', {kind:'storage'}); }
  if (!Array.isArray(rows) || rows.some(r => !r || typeof r.caseId !== 'string' ||
      typeof r.recordedAt !== 'string' || !Number.isFinite(Date.parse(r.recordedAt)) ||
      !(r.estimatedUsd === null || (typeof r.estimatedUsd === 'number' && Number.isFinite(r.estimatedUsd) && r.estimatedUsd >= 0)))) {
    throw new ModelFailure('Invalid usage ledger', {kind:'storage'});
  }
  return rows;
}
export async function budgetedRequest<T>(args: {
  caseId: string; model: string; bytes: number; request: () => Promise<T>;
}): Promise<T> {
  const path = process.env.META_USAGE_LEDGER ?? 'data/meta-usage.json';
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let fd: number;
  try { fd = openSync(path + '.lock', 'wx', 0o600); }
  catch { throw new ModelFailure('Model concurrency limit or ledger lock active', {kind:'concurrency'}); }
  const start = Date.now();
  try {
    const cap = Number(process.env.GLOBAL_AI_SPEND_LIMIT ?? 2);
    const inputPrice = Number(process.env.META_INPUT_USD_PER_MILLION ?? 1.25);
    const outputPrice = Number(process.env.META_OUTPUT_USD_PER_MILLION ?? 4.25);
    if (![cap,inputPrice,outputPrice].every(n=>Number.isFinite(n)&&n>0)) throw new ModelFailure('Invalid spending configuration');
    // Conservative byte-based text estimate; image billing must be configured
    // with a reviewed upper reservation before live vision is enabled.
    const reserve = requestReservation(args.bytes, inputPrice, outputPrice);
    const records = readUsageRecords(path);
    if (records.some(r=>r.estimatedUsd === null)) throw new ModelFailure('Legacy unknown usage requires reconciliation', {kind:'budget',code:'unreconciled_usage'});
    const caseSpent = records.filter(r=>r.caseId===args.caseId).reduce((sum,r)=>sum+(r.estimatedUsd ?? cap),0);
    const caseLimit = Number(process.env.META_CASE_USD_LIMIT ?? 0.5);
    const recent = records.filter(r=>Date.parse(r.recordedAt)>Date.now()-60_000).length;
    if (!Number.isFinite(caseLimit) || caseLimit <= 0 || caseSpent + reserve > caseLimit || recent >= 30) throw new ModelFailure('Model case budget or rate limit reached', {kind:'budget',code:'case_or_rate_limit'});
    const spent = records.reduce((sum,r)=>sum+(r.estimatedUsd ?? cap),0);
    if (spent + reserve > cap ||
        records.filter(r=>r.caseId===args.caseId).length >= Number(process.env.META_CASE_CALL_LIMIT ?? 30)) throw new ModelFailure('Model budget or per-case limit reached', {kind:'budget',code:'global_or_call_limit'});
    const persist = () => { writeFileSync(path+'.tmp',JSON.stringify(records,null,2),{mode:0o600}); renameSync(path+'.tmp',path); };
    // Charge the conservative reservation BEFORE network access. Failures, missing
    // usage and crashes retain it; only measured usage can replace the estimate.
    const record: UsageRecord = { id:randomUUID(),requestBytes:args.bytes,reservedUsd:reserve,accounting:'reserved',caseId:args.caseId,model:args.model,promptVersion:'intake-v2',schemaVersion:'v1',inputUsdPerMillion:inputPrice,outputUsdPerMillion:outputPrice,priceEffectiveDate:process.env.META_PRICE_EFFECTIVE_DATE ?? '2026-10-29',latencyMs:0,inputTokens:null,outputTokens:null,estimatedUsd:reserve,success:false,recordedAt:new Date().toISOString() };
    records.push(record); persist();
    try {
      const response = await args.request();
      const usage = (response as {usage?:{prompt_tokens?:number;completion_tokens?:number}}).usage;
      if (Number.isSafeInteger(usage?.prompt_tokens) && usage!.prompt_tokens! >= 0 && Number.isSafeInteger(usage?.completion_tokens) && usage!.completion_tokens! >= 0) {
        record.inputTokens=usage!.prompt_tokens!;record.outputTokens=usage!.completion_tokens!;
        record.estimatedUsd=(record.inputTokens*inputPrice+record.outputTokens*outputPrice)/1e6;
        record.accounting='measured';
      }
      record.success=true; return response;
    } catch (e) {
      const failure = e instanceof ModelFailure ? e : new ModelFailure('Model request failed', {kind:'network'});
      record.failure = failure.details;
      throw failure;
    } finally { record.latencyMs=Date.now()-start;persist(); }
  } catch (e) {
    if (e instanceof ModelFailure) throw e;
    throw new ModelFailure("Model request or usage ledger failed", {kind:'storage'});
  } finally { closeSync(fd);unlinkSync(path+'.lock'); }
}
