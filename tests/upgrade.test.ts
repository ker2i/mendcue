import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { FixtureProvider } from '../src/integrations/meta/fixture.js';
import { groundedIssueAreas } from '../src/domain/brief.js';
import { type KnowledgeChunk, retrieveKnowledge, evidenceReference } from '../src/domain/knowledge.js';
import { parseLabelText } from '../src/domain/labelparse.js';
import { demoDocuments, demoChunks } from '../src/content/seed.js';
import { testApp, startSession, say } from './helpers.js';
const d = { ...demoDocuments()[0], id:'official', brand:'LG', explicitModels:['WM3900HBA'], hash:'immutable-sha', version:'v7' };
const c: KnowledgeChunk = { ...demoChunks()[0], documentId:d.id, version:d.version, applicability:{ models:['WM3900HBA'], families:[], categories:['washer'] } };
const retrieve = (model:string|null, brand='LG', chunk=c, doc=d) => retrieveKnowledge({chunks:[chunk],documents:new Map([[doc.id,doc]]),tenantId:'tnt_demo_phoenix',modelNormalized:model,brand,category:'washer',query:'water'});
describe('upgrade evidence boundaries', () => {
  it('does not extract GE from fridge or misclassify a two-compartment fridge report', async () => {
    const result=await new FixtureProvider().extractIntakeTurn({tenantId:'t',caseId:'c',messageId:'m',messageText:'Fridge warm but freezer fine',knownFacts:[],askedQuestionIds:[],allowedQuestionIds:[],allowedActionIds:[],category:null,activeQuestion:null,recentMessages:[]});
    expect(result.proposedFacts.some(f=>f.key==='brand')).toBe(false);
    expect(result.proposedFacts.find(f=>f.key==='appliance_category')?.value).toBe('refrigerator');
  });
  it('never infers a model from an unlabeled long serial', () => {
    expect(parseLabelText('SER ABC123456789012345 120V 60HZ').modelRaw).toBeNull();
    expect(parseLabelText('MODEL WM3900HBA SERIAL ABC123456789012345').modelRaw).toBe('WM3900HBA');
    expect(parseLabelText('MODEL WM3900HBA').ambiguous).toBe(false);
  });
  it('blocks wrong-brand collisions and restricted manual category fallback', () => {
    expect(retrieve('WM3900HBA','Samsung')).toEqual([]);
    expect(retrieve('WM3900HWA')).toEqual([]);
    expect(retrieve(null)).toEqual([]);
    expect(retrieve('WM3900HBA')[0].level).toBe('exact_model');
  });
  it('requires explicit family membership instead of a model prefix', () => {
    const doc={...d,explicitFamilies:['WM-family']};
    const chunk={...c,applicability:{models:[],families:['WM-family'],categories:['washer']}};
    expect(retrieve('WM3900HBA','LG',chunk,doc)[0].level).toBe('verified_family');
    expect(retrieve('WM3900HBA-OTHER','LG',chunk,doc)).toEqual([]);
  });
  it('binds evidence to document version, hash and actual PDF page', () => {
    const hit=retrieve('WM3900HBA')[0]; const ref=evidenceReference(hit,new Map([[d.id,d]]));
    expect(ref).toMatchObject({documentVersion:'v7',documentHash:'immutable-sha',pdfPageIndex:0,excerpt:c.text});
    expect(retrieve('WM3900HBA','LG',{...c,version:'v6'})).toEqual([]);
  });
  it('reduces unsupported model-specific prose instead of trusting citation IDs', () => {
    const hypotheses=[{issueArea:'Replace exact part XYZ for $900, 99% certain',priority:'primary' as const,evidenceStrength:'strong' as const,supportingFactIds:['f1'],contradictingFactIds:[],sourceChunkIds:[c.id],limitations:[]}];
    const facts=[{id:'f1',key:'problem_description',value:'washer stopped'}] as any;
    expect(groundedIssueAreas({hypotheses,recommendedFollowUp:'buy part XYZ'},facts)[0].issueArea).not.toMatch(/XYZ|900|99/);
    expect(groundedIssueAreas({hypotheses,recommendedFollowUp:''},[])).toEqual([]);
  });
  it('manual identity confirms structured fields; later correction invalidates confirmation', async () => {
    const {app,store}=await testApp(); const s=await startSession(app,'pk_demo_phoenix_001');
    const result=await request(app).post(`/api/v1/cases/${s.caseId}/confirm-model`).auth(s.token,{type:'bearer'}).send({confirm:true,correctedModel:'WM3900HBA.ABWE',brand:'LG',serialNumber:'1234567890123456'});
    expect(result.status).toBe(200);
    const state=await request(app).get(`/api/v1/cases/${s.caseId}`).auth(s.token,{type:'bearer'});
    expect(state.body.facts.find((f:any)=>f.key==='serial_number').value).toBe('1234567890123456');
    const change=await request(app).patch(`/api/v1/cases/${s.caseId}/facts`).auth(s.token,{type:'bearer'}).send({key:'brand',value:'Samsung',version:state.body.case.version});
    expect(change.status).toBe(200);
    const facts=await store.listFacts('tnt_demo_phoenix',s.caseId);
    expect(facts.filter(f=>f.status!=='superseded').some(f=>f.key==='model_confirmed')).toBe(false);
  });
  it('screens hazards in structured identity confirmation',async()=>{
    const {app}=await testApp();const s=await startSession(app,'pk_demo_phoenix_001');
    const r=await request(app).post(`/api/v1/cases/${s.caseId}/confirm-model`).auth(s.token,{type:'bearer'}).send({confirm:true,correctedModel:'strong gas smell'});
    expect(r.status).toBe(400);expect(r.body.safetyStatus).toBe('emergency');
  });
  it('records technician approval separately and preserves the original snapshot',async()=>{
    const {app,store}=await testApp();const s=await startSession(app,'pk_demo_phoenix_001');
    await say(app,s.caseId,s.token,'Washer not draining');await say(app,s.caseId,s.token,'done');
    await request(app).post(`/api/v1/cases/${s.caseId}/submit`).auth(s.token,{type:'bearer'}).send({acknowledgeIncomplete:true});
    const before=await store.listHandoffs('tnt_demo_phoenix',s.caseId);
    const login=await request(app).post('/api/v1/staff/login').send({tenantSlug:'demo-phoenix-appliance',email:'tech@demo-phoenix.invalid',password:'demo-tech-1234'});
    const cookies=(login.headers['set-cookie'] as unknown as string[]).map(x=>x.split(';')[0]).join('; ');
    const current=await store.getCase('tnt_demo_phoenix',s.caseId);
    const r=await request(app).post(`/api/v1/staff/cases/${s.caseId}/review`).set('cookie',cookies).set('x-csrf-token',login.body.csrf).send({version:current!.version,disposition:'ready_to_contact',missingFacts:['Timeline'],unsupportedAssertions:[],reviewSeconds:45,timingMethod:'manual',revisedBrief:'Customer reports standing water. Call for timeline.'});
    expect(r.status).toBe(201);expect(r.body.review.payload.approved).toBe(true);
    expect(await store.listHandoffs('tnt_demo_phoenix',s.caseId)).toEqual(before);
  });
});
