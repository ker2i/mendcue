// Validate human grades and export per-case JSON + CSV. No synthetic savings.
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
const schema=z.array(z.object({
  runId:z.string().min(1),kind:z.enum(['synthetic','real_anonymized']),label:z.enum(['A','B']),
  grade:z.enum(['useful_as_received','useful_after_corrections','needed_followup','misleading_or_unusable']),
  missingFacts:z.array(z.string()),unsupportedAssertions:z.array(z.string()),
  knownCriticalFactsExpected:z.number().int().nonnegative().nullable(),
  knownCriticalFactsCaptured:z.number().int().nonnegative().nullable(),
  unavailableFacts:z.array(z.string()),identificationCorrect:z.boolean().nullable(),
  documentationApplies:z.boolean().nullable(),reviewSeconds:z.number().nonnegative().nullable(),
  timingMethod:z.enum(['manual','measured','estimated','not_recorded']),
  followupQuestions:z.number().int().nonnegative().nullable(),approvedBrief:z.string().nullable(),
})).superRefine((rows,ctx)=>{
  const keys=new Set();for(const r of rows){const key=r.runId+':'+r.label;
    if(keys.has(key))ctx.addIssue({code:'custom',message:'Duplicate grade'});keys.add(key);
    if(r.knownCriticalFactsCaptured!==null && (r.knownCriticalFactsExpected===null || r.knownCriticalFactsCaptured>r.knownCriticalFactsExpected))ctx.addIssue({code:'custom',message:'Invalid critical-fact denominator'});
    if((r.reviewSeconds===null)!==(r.timingMethod==='not_recorded'))ctx.addIssue({code:'custom',message:'Timing provenance mismatch'});
  }
});
const [file,out='data/grades-report']=process.argv.slice(2);if(!file)throw new Error('Usage: node scripts/grade-comparison.mjs private-grades.json [output-prefix]');
const grades=schema.parse(JSON.parse(readFileSync(file,'utf8')));
const report={generatedAt:new Date().toISOString(),grades,groups:['synthetic','real_anonymized'].map(kind=>{
  const rows=grades.filter(r=>r.kind===kind);return {kind,gradedOutputs:rows.length,pairedRuns:[...new Set(rows.map(r=>r.runId))].filter(id=>rows.filter(r=>r.runId===id).length===2).length,
    missingTiming:rows.filter(r=>r.reviewSeconds===null).length,missingCompleteness:rows.filter(r=>r.knownCriticalFactsExpected===null).length,
    grades:Object.fromEntries(['useful_as_received','useful_after_corrections','needed_followup','misleading_or_unusable'].map(g=>[g,rows.filter(r=>r.grade===g).length]))};
})};
writeFileSync(out+'.json',JSON.stringify(report,null,2),{mode:0o600});
const columns=['runId','kind','label','grade','reviewSeconds','timingMethod','followupQuestions','knownCriticalFactsExpected','knownCriticalFactsCaptured'];
const escape=value=>'"'+String(value??'').replaceAll('"','""')+'"';
writeFileSync(out+'.csv',[columns.join(','),...grades.map(r=>columns.map(c=>escape(r[c])).join(','))].join('\n'),{mode:0o600});
console.log('Exported human grades with explicit units, missing measurements and separate real/synthetic counts.');
