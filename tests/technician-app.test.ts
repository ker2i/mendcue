import {it,expect,afterEach,vi} from 'vitest';
import request from 'supertest';
import {randomUUID,createECDH} from 'node:crypto';
import webpush from 'web-push';
import {testApp} from './helpers.js';
import {createCase,submitCase} from '../src/domain/intake.js';
import {FixtureProvider} from '../src/integrations/meta/fixture.js';
import {localToUtc} from '../src/server/technician.js';
import {deliverPush,validateSubscription,publicAddress,eligibleRegistrations,newBriefPushJob} from '../src/integrations/push.js';
import type {PushRegistration} from '../src/db/store.js';
async function setup(){
 const {app,store}=await testApp(),tenant=(await store.getTenantBySlug('demo-phoenix-appliance'))!;
 const login=await request(app).post('/api/v1/staff/login').send({tenantSlug:tenant.slug,email:'tech@demo-phoenix.invalid',password:'demo-tech-1234'});
 const cookies=(login.headers['set-cookie'] as unknown as string[]).map(x=>x.split(';')[0]).join('; '),headers={cookie:cookies,'x-csrf-token':login.body.csrf};
 const provider=new FixtureProvider(),deps={store,provider,storageGet:async()=>null};
 const make=async()=>{const c=await createCase(deps,tenant,'widget');c.conversationPhase='review';await store.updateCase(c);await submitCase(deps,tenant,c.id,{acknowledgeIncomplete:true});return (await store.getCase(tenant.id,c.id))!;};
 const post=(id:string,data:Record<string,unknown>)=>request(app).post(`/api/v1/staff/cases/${id}/action`).set(headers).send(data);
 return {app,store,tenant,login,headers,make,post};
}
const future=()=>new Date(Date.now()+7*86400000).toISOString().slice(0,10);
afterEach(()=>vi.unstubAllEnvs());
it('interprets Phoenix time independently of the server timezone and rejects invalid/DST times',()=>{
 expect(localToUtc('2026-11-05T09:30','America/Phoenix')).toBe('2026-11-05T16:30:00.000Z');
 expect(()=>localToUtc('2026-02-30T10:00','America/Phoenix')).toThrow();
 expect(()=>localToUtc('2027-03-14T02:30','America/New_York')).toThrow();
 expect(()=>localToUtc('2026-11-01T01:30','America/New_York')).toThrow();
});
it('books, rejects overlap, reschedules and cancels an appointment without changing the submitted brief',async()=>{
 const {app,store,tenant,headers,make,post}=await setup(),c=await make(),other=await make(),day=future();
 const original=await store.listHandoffs(tenant.id,c.id);
 const body={kind:'appointment',version:c.version,clientMutationId:randomUUID(),startsLocal:day+'T10:00',endsLocal:day+'T11:00',note:'Synthetic appointment',reminderMinutes:30};
 const r=await post(c.id,body);expect(r.status).toBe(200);expect(r.body.workflowStatus).toBe('scheduled');expect(r.body.appointment.startsAt).toBe(day+'T17:00:00.000Z');
 expect((await post(other.id,{...body,version:other.version,clientMutationId:randomUUID()})).body.error.code).toBe('APPOINTMENT_OVERLAP');
 expect((await store.getCase(tenant.id,other.id))!.version).toBe(other.version);
 const changed=await post(c.id,{...body,version:r.body.version,clientMutationId:randomUUID(),startsLocal:day+'T12:00',endsLocal:day+'T13:00'});expect(changed.status).toBe(200);
 const calendar=await request(app).get('/api/v1/staff/calendar').query({from:day+'T00:00:00.000Z',to:day+'T23:59:59.000Z'}).set(headers);expect(calendar.body.appointments).toHaveLength(1);expect(calendar.body.timezone).toBe('America/Phoenix');
 const cancel=await post(c.id,{kind:'unschedule',version:changed.body.version,clientMutationId:randomUUID()});expect(cancel.status).toBe(200);expect(cancel.body.appointment.active).toBe(false);
 expect(await store.listHandoffs(tenant.id,c.id)).toEqual(original);
});
it('reconciles a lost response with one note and rejects mutation-ID reuse or stale versions',async()=>{
 const {app,store,tenant,headers,make,post}=await setup(),c=await make(),other=await make();
 const body={kind:'note',note:'Synthetic visit note',version:c.version,clientMutationId:randomUUID()};
 const [a,b]=await Promise.all([post(c.id,body),post(c.id,body)]);expect(a.status).toBe(200);expect(b.body).toEqual(a.body);
 expect((await store.listEvents(tenant.id,c.id)).filter(e=>e.type==='staff_note')).toHaveLength(1);
 expect((await post(c.id,{...body,note:'Changed input'})).body.error.code).toBe('MUTATION_ID_CONFLICT');
 expect((await post(other.id,body)).body.error.code).toBe('MUTATION_ID_CONFLICT');
 expect((await post(c.id,{...body,clientMutationId:randomUUID()})).body.error.code).toBe('CASE_VERSION_CONFLICT');
 const receipt=await request(app).get(`/api/v1/staff/cases/${c.id}/mutations/${body.clientMutationId}`).set(headers);expect(receipt.body).toEqual(a.body);
 expect((await request(app).get(`/api/v1/staff/cases/${other.id}/mutations/${body.clientMutationId}`).set(headers)).status).toBe(404);
});
it('keeps readonly, foreign cases and missing CSRF out of scheduling and notes',async()=>{
 const {app,store,tenant,headers,make,post,login}=await setup(),c=await make();
 const body={kind:'note',note:'Not allowed',version:c.version,clientMutationId:randomUUID()};
 expect((await request(app).post(`/api/v1/staff/cases/${c.id}/action`).set('cookie',headers.cookie).send(body)).status).toBe(403);
 const user=(await store.getStaffById(tenant.id,login.body.user.id))!;await store.saveStaffUser({...user,role:'readonly'});
 expect((await post(c.id,body)).status).toBe(403);
 const otherTenant=(await store.getTenantBySlug('demo-harbor-warranty'))!;const foreign=await createCase({store,provider:new FixtureProvider(),storageGet:async()=>null},otherTenant,'hosted');
 expect((await request(app).get(`/api/v1/staff/cases/${foreign.id}`).set(headers)).status).toBe(404);
});
it('bounds inbox search and never treats drafts as new jobs',async()=>{
 const {app,store,tenant,headers,make}=await setup();await make();await make();
 await createCase({store,provider:new FixtureProvider(),storageGet:async()=>null},tenant,'widget');
 const r=await request(app).get('/api/v1/staff/cases?view=new&limit=1').set(headers);expect(r.body.cases).toHaveLength(1);expect(r.body.hasMore).toBe(true);
 const next=await request(app).get('/api/v1/staff/cases?view=new&limit=1&offset=1').set(headers);expect(next.body.cases[0].id).not.toBe(r.body.cases[0].id);
 expect((await request(app).get('/api/v1/staff/cases?view=draft').set(headers)).body.cases).toHaveLength(1);
 expect((await request(app).get('/api/v1/staff/cases?view=new&search=nosuchrequest').set(headers)).body.cases).toHaveLength(0);
});
function subscription(){const e=createECDH('prime256v1');return {endpoint:'https://fcm.googleapis.com/wp/'+randomUUID(),keys:{p256dh:e.generateKeys().toString('base64url'),auth:Buffer.alloc(16,3).toString('base64url')}};}
it('rejects arbitrary push URLs, malformed keys and private socket addresses',()=>{
 const s=subscription();expect(validateSubscription(s)).toMatch(/^[a-f0-9]{64}$/);
 for(const endpoint of ['http://fcm.googleapis.com/wp/a','https://127.0.0.1/a','https://fcm.googleapis.com.evil.test/a','https://user@fcm.googleapis.com/a','https://fcm.googleapis.com:444/a','https://fcm.googleapis.com/a#x'])expect(()=>validateSubscription({...s,endpoint})).toThrow();
 expect(()=>validateSubscription({...s,keys:{...s.keys,p256dh:'bad'}})).toThrow();
 for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','192.168.1.3','::1','::ffff:127.0.0.1','fe80::1'])expect(publicAddress(ip)).toBe(false);
 expect(publicAddress('8.8.8.8')).toBe(true);
});
it('persists push progress, suppresses revoked sessions, handles gone devices and snapshots eligible recipients',async()=>{
 const keys=webpush.generateVAPIDKeys();vi.stubEnv('PUSH_ENABLED','1');vi.stubEnv('VAPID_PUBLIC_KEY',keys.publicKey);vi.stubEnv('VAPID_PRIVATE_KEY',keys.privateKey);vi.stubEnv('VAPID_SUBJECT','mailto:synthetic@example.invalid');
 const {store,tenant,login,make}=await setup();const session=[...store.staffSessions.values()][0];
 const add=async()=>{const s=subscription(),r:PushRegistration={...s,id:randomUUID(),tenantId:tenant.id,userId:login.body.user.id,sessionId:session.id,endpointHash:validateSubscription(s),enabled:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};expect(await store.savePushRegistration(r)).toBe(true);return r;};
 const a=await add(),b=await add(),c=await make();const push=(await store.listJobs(tenant.id)).find(j=>j.kind==='staff_push')!;expect(push.payload.targets).toEqual([a.id,b.id]);
 const late=await add();let calls:string[]=[];let fail=true;
 const sender=async(r:PushRegistration)=>{calls.push(r.id);if(r.id===b.id&&fail)throw Error('Synthetic network loss');};
 await expect(deliverPush(store,push,sender)).rejects.toThrow();fail=false;await deliverPush(store,push,sender);
 expect(calls.filter(id=>id===a.id)).toHaveLength(1);expect(calls.filter(id=>id===b.id)).toHaveLength(2);expect(calls).not.toContain(late.id);
 const gone=(await newBriefPushJob(store,tenant.id,c.id))[0];await deliverPush(store,gone,async()=>{throw {statusCode:410};});expect(await store.listPushRegistrations(tenant.id)).toHaveLength(0);
 const fresh=await add();await store.deleteStaffSession(tenant.id,session.id);expect(await eligibleRegistrations(store,tenant.id)).toHaveLength(0);expect((await store.listPushRegistrations(tenant.id)).some(r=>r.id===fresh.id)).toBe(false);
});
it('scopes the installable shell to staff and preserves legacy links',async()=>{
 const {app}=await testApp();const old=await request(app).get('/staff?business=demo-phoenix-appliance');expect(old.status).toBe(308);expect(old.headers.location).toBe('/staff/?business=demo-phoenix-appliance');
 const manifest=await request(app).get('/staff/manifest.webmanifest');expect(manifest.body.scope).toBe('/staff/');expect(manifest.body.start_url).toBe('/staff/');
 expect((await request(app).get('/staff/icon-192.png')).headers['content-type']).toContain('image/png');
 const worker=await request(app).get('/staff/sw.js');expect(worker.headers['service-worker-allowed']).toBe('/staff/');expect(worker.text).not.toContain('__APP_VERSION__');
 expect((await request(app).get('/staff/')).text).toContain('/staff/app.js?v=');
});
it('retires obsolete reminder jobs atomically when a visit moves or is cancelled',async()=>{
 const keys=webpush.generateVAPIDKeys();vi.stubEnv('PUSH_ENABLED','1');vi.stubEnv('VAPID_PUBLIC_KEY',keys.publicKey);vi.stubEnv('VAPID_PRIVATE_KEY',keys.privateKey);vi.stubEnv('VAPID_SUBJECT','mailto:synthetic@example.invalid');
 const {store,tenant,make,post}=await setup(),c=await make(),day=future();
 const body={kind:'appointment',version:c.version,clientMutationId:randomUUID(),startsLocal:day+'T10:00',endsLocal:day+'T11:00',reminderMinutes:30};
 const first=await post(c.id,body);expect(first.status).toBe(200);
 const old=(await store.listJobs(tenant.id)).find(j=>j.kind==='staff_reminder')!;expect(old.status).toBe('pending');
 const next=await post(c.id,{...body,version:first.body.version,clientMutationId:randomUUID(),startsLocal:day+'T12:00',endsLocal:day+'T13:00'});expect(next.status).toBe(200);
 const jobs=await store.listJobs(tenant.id);expect(jobs.find(j=>j.id===old.id)!.status).toBe('done');expect(jobs.filter(j=>j.kind==='staff_reminder'&&j.status==='pending')).toHaveLength(1);
 expect((await post(c.id,{kind:'unschedule',version:next.body.version,clientMutationId:randomUUID()})).status).toBe(200);
 expect((await store.listJobs(tenant.id)).filter(j=>j.kind==='staff_reminder'&&j.status==='pending')).toHaveLength(0);
});
