// Synthetic local PDF/CLI checks. Requires a build and Poppler's pdftotext on PATH.
// All files live in an isolated temporary directory; no model is used.
// Optional TEST_POSTGRES_URL must be a dedicated local, migrated, demo-seeded test DB.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { PgStore } from '../dist/db/pg.js';
import { retrieveKnowledge, evidenceReference } from '../dist/domain/knowledge.js';

// A deliberately synthetic, two-page, text PDF; no manufacturer material or claims.
function fixturePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    null,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  ['Synthetic page one: fixture model TEST-100 only.', 'Synthetic page two: no real repair guidance.'].forEach((text,i) => {
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET\n`;
    objects[3 + i*2] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`;
  });
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object,i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i+1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10,'0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

execFileSync('pdftotext', ['-v'], {stdio:'pipe'});
const root = mkdtempSync(join(tmpdir(),'mendcue-pdf-'));
const importer = fileURLToPath(new URL('./import-knowledge.mjs', import.meta.url));
const env = {...process.env, DATABASE_URL:'', MODEL_API_KEY:'', MODEL_PROVIDER:'fixture'};
const run = (...args) => spawnSync(process.execPath, [importer,...args], {cwd:root, env, encoding:'utf8', timeout:30000});
const testUrl = process.env.TEST_POSTGRES_URL;
if (testUrl) {
  const url = new URL(testUrl);
  if (!['localhost','127.0.0.1'].includes(url.hostname) || !url.pathname.startsWith('/mendcue_test')) {
    rmSync(root,{recursive:true,force:true});
    throw Error('PDF publish checks require a dedicated local mendcue_test database');
  }
}
try {
  const pdf = fixturePdf(); const hash = createHash('sha256').update(pdf).digest('hex');
  const manifest = {tenantId:'synthetic-test', publisher:'Synthetic acceptance fixture', title:'Not a real manual',
    sourceUrl:null, usageBasis:'Locally generated synthetic test text; no real appliance guidance.',
    brand:'SYNTHETIC', models:['TEST-100'], version:'synthetic-1', reviewedBy:'Must be cleared from draft',
    extractionReviewed:true, applicabilityReviewed:true};
  writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest));
  writeFileSync(join(root,'fixture.pdf'),pdf);
  const prepared = run('prepare','manifest.json','fixture.pdf');
  assert.equal(prepared.status,0,prepared.stderr);
  const bundlePath = join(root,'data/knowledge',`${hash}.json`);
  const originalPath = join(root,'data/knowledge',`${hash}.pdf`);
  const bundle = JSON.parse(readFileSync(bundlePath,'utf8'));
  assert.equal(bundle.documentHash,hash); assert.deepEqual(readFileSync(originalPath),pdf);
  assert.deepEqual(bundle.pages.map(p => p.pdfPageIndex),[0,1]);
  assert.match(bundle.pages[0].text,/page one.*TEST-100/); assert.match(bundle.pages[1].text,/page two/);
  console.log('PASS original bytes, real Poppler extraction and PDF page indexes');
  assert.equal(bundle.manifest.reviewedBy,null);
  assert.equal(bundle.manifest.extractionReviewed,false); assert.equal(bundle.manifest.applicabilityReviewed,false);
  assert(bundle.pages.every(p => p.include === false && p.printedPageLabel === null));
  console.log('PASS draft requires explicit extraction, applicability, page-label and inclusion review');
  assert.equal(statSync(bundlePath).mode & 0o777,0o600); assert.equal(statSync(originalPath).mode & 0o777,0o600);
  assert.equal(statSync(join(root,'data/knowledge')).mode & 0o777,0o700);
  console.log('PASS private original, bundle and directory permissions');
  const rejected = run('publish',bundlePath);
  assert.notEqual(rejected.status,0); assert.match(rejected.stderr,/Named human review/);
  console.log('PASS unreviewed publish rejected before database access');
  // Simulate review fields solely to test the remaining rejection gates on this synthetic PDF.
  bundle.manifest = {...bundle.manifest, reviewedBy:'Synthetic scripted fixture', extractionReviewed:true, applicabilityReviewed:true};
  writeFileSync(bundlePath,JSON.stringify(bundle));
  assert.match(run('publish',bundlePath).stderr,/Select reviewed sections/);
  bundle.pages[0].include=true; writeFileSync(bundlePath,JSON.stringify(bundle));
  writeFileSync(originalPath,Buffer.concat([pdf,Buffer.from('tamper')]));
  assert.match(run('publish',bundlePath).stderr,/Original hash mismatch/);
  console.log('PASS empty selection and tampered original rejected before database access');
  if (testUrl) {
    const pool = new Pool({connectionString:testUrl});
    try {
      const store = new PgStore(pool);
      const tenant = await store.getTenantBySlug('demo-phoenix-appliance'); assert(tenant,'Seed the dedicated test database first');
      bundle.manifest.tenantId=tenant.id; bundle.pages[0].printedPageLabel='S-1';
      writeFileSync(bundlePath,JSON.stringify(bundle)); writeFileSync(originalPath,pdf);
      const published = spawnSync(process.execPath,[importer,'publish',bundlePath],{cwd:root,env:{...env,DATABASE_URL:testUrl},encoding:'utf8',timeout:30000});
      assert.equal(published.status,0,published.stderr);
      const documents = (await store.listDocuments(tenant.id)).filter(d => d.hash === hash);
      assert.equal(documents.length,1); assert.equal(documents[0].usageBasis,manifest.usageBasis);
      const chunks = (await store.listChunks(tenant.id)).filter(c => c.documentId === documents[0].id);
      assert.equal(chunks.length,1); assert.equal(chunks[0].pageIndex,0); assert.equal(chunks[0].pageLabel,'S-1');
      const input = {tenantId:tenant.id,documents:new Map(documents.map(d => [d.id,d])),chunks,brand:'SYNTHETIC',modelNormalized:'TEST-100',category:null,query:'fixture'};
      const hits = retrieveKnowledge(input); assert.equal(hits.length,1); assert.equal(hits[0].level,'exact_model');
      const citation = evidenceReference(hits[0],input.documents);
      assert.equal(citation.documentHash,hash); assert.equal(citation.pdfPageIndex,0); assert.equal(citation.printedPageLabel,'S-1');
      assert.equal(retrieveKnowledge({...input,modelNormalized:'TEST-101'}).length,0);
      const other = (await store.listTenants()).find(t => t.id !== tenant.id); assert(other);
      assert(!(await store.listDocuments(other.id)).some(d => d.id === documents[0].id));
      console.log('PASS synthetic CLI publish, selected-page citation, exact-model applicability and tenant isolation');
    } finally { await pool.end(); }
  }
  console.log(`${testUrl?'6/6':'5/5'} synthetic PDF checks passed. Real manuals, human approval and production coverage remain unverified.`);
} finally { rmSync(root,{recursive:true,force:true}); }
