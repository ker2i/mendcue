// Explicit operator recovery for a VERIFIED TEXT-ONLY legacy request. Keeps an
// exclusive backup and charges the enforced maximum request reservation, not zero.
import {openSync,closeSync,unlinkSync,copyFileSync,writeFileSync,renameSync,constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {readUsageRecords,requestReservation} from '../dist/integrations/meta/usage.js';
import {MODEL_REQUEST_BYTES} from '../dist/integrations/storage/images.js';
const [file,caseId,recordedAt,basis]=process.argv.slice(2);
if(!file||!caseId||!recordedAt||!basis?.trim()||process.argv.length!==6)throw Error('Usage: node scripts/reconcile-model-usage.mjs LEDGER CASE_ID RECORDED_AT VERIFIED_TEXT_ONLY_REASON');
const fd=openSync(file+'.lock','wx',0o600);
try {
 const rows=readUsageRecords(file);
 const matches=rows.filter(r=>r.caseId===caseId&&r.recordedAt===recordedAt);
 if(matches.length!==1||matches[0].estimatedUsd!==null)throw Error('Expected exactly one unreconciled legacy record');
 const row=matches[0];
 if(row.model!=='muse-spark-1.3')throw Error('Unsupported legacy model');
 const reserve=requestReservation(MODEL_REQUEST_BYTES,row.inputUsdPerMillion,row.outputUsdPerMillion);
 const backup=file+'.backup-'+randomUUID();
 copyFileSync(file,backup,constants.COPYFILE_EXCL); // Existing ledger is private.
 row.estimatedUsd=reserve;row.reservedUsd=reserve;row.accounting='reserved';
 row.reconciliation={at:new Date().toISOString(),basis,previousEstimatedUsd:null,maxRequestBytes:MODEL_REQUEST_BYTES};
 writeFileSync(file+'.tmp',JSON.stringify(rows,null,2),{mode:0o600});renameSync(file+'.tmp',file);
 console.log(JSON.stringify({backup,reservedUsd:reserve,remainingUnboundedRecords:rows.filter(r=>r.estimatedUsd===null).length}));
}finally{closeSync(fd);unlinkSync(file+'.lock');}
