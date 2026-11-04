import { readFileSync } from 'node:fs';
const file=process.argv[2]??process.env.META_USAGE_LEDGER??'data/meta-usage.json';
const rows=JSON.parse(readFileSync(file,'utf8'));
if(!Array.isArray(rows))throw Error('Invalid usage ledger');
console.log(JSON.stringify({requests:rows.length,completedHTTP:rows.filter(r=>r.success).length,unknownUsage:rows.filter(r=>r.estimatedUsd===null).length,
 reservedRequests:rows.filter(r=>r.accounting==='reserved').length,reservedUsd:rows.filter(r=>r.accounting==='reserved').reduce((n,r)=>n+(r.estimatedUsd??0),0),
 failures:rows.filter(r=>r.failure).map(r=>({recordedAt:r.recordedAt,...r.failure})),
 inputTokens:rows.reduce((n,r)=>n+(r.inputTokens??0),0),outputTokens:rows.reduce((n,r)=>n+(r.outputTokens??0),0),
 estimatedUsd:rows.reduce((n,r)=>n+(r.estimatedUsd??0),0),latencyMs:rows.map(r=>r.latencyMs),
 billingUncertain:rows.some(r=>r.estimatedUsd===null||r.accounting==='reserved')},null,2));
