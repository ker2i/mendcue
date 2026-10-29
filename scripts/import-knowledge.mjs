// Operator-only, local-file import. No network fetching or customer URLs.
// prepare: PDF -> private review bundle. publish: approved review bundle -> DB.
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { z } from 'zod';
import { PgStore } from '../dist/db/pg.js';
const [command, filename, pdf] = process.argv.slice(2);
const manifestSchema = z.object({
  tenantId: z.string().min(1), publisher: z.string().min(1), title: z.string().min(1),
  sourceUrl: z.string().url().nullable(), usageBasis: z.string().min(10),
  brand: z.string().min(1), models: z.array(z.string().min(1)).min(1),
  version: z.string().min(1), reviewedBy: z.string().min(1).nullable(),
  extractionReviewed: z.boolean(), applicabilityReviewed: z.boolean(),
});
const hash = b => createHash('sha256').update(b).digest('hex');
if (!filename || !['prepare','publish'].includes(command)) throw new Error('Usage: node scripts/import-knowledge.mjs prepare manifest.json original.pdf | publish bundle.json');
if (command === 'prepare') {
  const m = manifestSchema.parse(JSON.parse(readFileSync(filename,'utf8')));
  const bytes = readFileSync(pdf); if (bytes.length > 20 * 1024 * 1024 || bytes.subarray(0,5).toString() !== '%PDF-') throw new Error('Expected PDF <=20 MiB');
  // Poppler preserves PDF page boundaries with form-feed. Scans remain unavailable.
  const text = execFileSync('pdftotext',['-layout',resolve(pdf),'-'],{ timeout:30000, maxBuffer:8*1024*1024 }).toString();
  const pages = text.split('\f'); if (!pages.at(-1).trim()) pages.pop();
  if (!pages.length || pages.every(p => p.trim().length < 20)) throw new Error('No reliable text; human transcription/review or supported Meta vision is required');
  const documentHash = hash(bytes); mkdirSync('data/knowledge', {recursive:true,mode:0o700});
  writeFileSync(`data/knowledge/${documentHash}.pdf`,bytes,{mode:0o600,flag:'wx'});
  const bundle = { manifest:{...m,reviewedBy:null,extractionReviewed:false,applicabilityReviewed:false}, documentHash,
    pages:pages.map((text,pdfPageIndex)=>({pdfPageIndex,printedPageLabel:null,text,include:false})) };
  writeFileSync(`data/knowledge/${documentHash}.json`,JSON.stringify(bundle,null,2),{mode:0o600,flag:'wx'});
  console.log(`Prepared data/knowledge/${documentHash}.json. Review original, extraction, page labels, selected sections and model applicability before publishing.`);
} else {
  const bundle = z.object({manifest:manifestSchema, documentHash:z.string().regex(/^[a-f0-9]{64}$/),pages:z.array(z.object({pdfPageIndex:z.number().int().nonnegative(),printedPageLabel:z.string().nullable(),text:z.string().min(1).max(50000),include:z.boolean()})).min(1)}).parse(JSON.parse(readFileSync(filename,'utf8')));
  const m=bundle.manifest;
  if (!m.reviewedBy || !m.extractionReviewed || !m.applicabilityReviewed) throw new Error('Named human review of extraction and applicability required');
  const original=readFileSync(`data/knowledge/${bundle.documentHash}.pdf`);
  if(hash(original)!==bundle.documentHash) throw new Error('Original hash mismatch');
  const selected=bundle.pages.filter(p=>p.include); if(!selected.length) throw new Error('Select reviewed sections/pages');
  const versionHash=hash(JSON.stringify(bundle)); const id=`doc_${versionHash}`;
  const pool=new Pool({connectionString:process.env.DATABASE_URL}); const store=new PgStore(pool);
  try {
    if(!await store.getTenant(m.tenantId)) throw new Error('Unknown tenant');
    await store.saveDocument({id,tenantId:m.tenantId,visibility:'tenant_private',publisher:m.publisher,sourceUrl:m.sourceUrl,documentType:'manufacturer_manual',title:m.title,language:'en',brand:m.brand,explicitModels:m.models,explicitFamilies:[],retrievedAt:new Date().toISOString(),hash:bundle.documentHash,version:m.version,reviewStatus:'approved',reviewedBy:m.reviewedBy,usageBasis:m.usageBasis});
    for(const p of selected) await store.saveChunk({id:`${id}_${p.pdfPageIndex}`,documentId:id,tenantId:m.tenantId,visibility:'tenant_private',version:m.version,pageIndex:p.pdfPageIndex,pageLabel:p.printedPageLabel,text:p.text,applicability:{models:m.models,families:[],categories:[]}});
    console.log(`Published immutable ${id}: ${selected.length} reviewed pages. Original remains private.`);
  } finally {await pool.end();}
}
