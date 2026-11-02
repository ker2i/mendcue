// Synthetic technician app: real browser, API, memory store and service worker.
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {MemoryStore} from '../dist/db/memory.js';import {seedStore} from '../dist/db/seed.js';
import {createApp} from '../dist/server/app.js';import {registerStaffRoutes} from '../dist/server/staff.js';import {registerPages} from '../dist/server/pages.js';
import {createCase,submitCase} from '../dist/domain/intake.js';import {FixtureProvider} from '../dist/integrations/meta/fixture.js';
import {FilesystemStorage} from '../dist/integrations/storage/storage.js';import {launchAcceptanceBrowser} from './browser-launch.mjs';
process.env.NODE_ENV='test';process.env.MODEL_PROVIDER='fixture';delete process.env.PUSH_ENABLED;
const store=new MemoryStore();await seedStore(store);const tenant=await store.getTenantBySlug('demo-phoenix-appliance');
const root=await mkdtemp(join(tmpdir(),'mendcue-technician-'));const storage=new FilesystemStorage(root),provider=new FixtureProvider();
const deps={store,storage,provider,baseUrl:'http://localhost:4319'},domain={store,provider,storageGet:k=>storage.get(k)};
const c=await createCase(domain,tenant,'hosted');
for(const [key,value] of Object.entries({appliance_category:'washer',problem_description:'Synthetic washer will not drain',service_zip:'85003',contact_channel:'synthetic@example.invalid'}))await store.addFact({id:randomUUID(),tenantId:tenant.id,caseId:c.id,key,value,status:'reported',sourceMessageId:null,sourceAttachmentId:null,certainty:'explicit',createdAt:new Date().toISOString(),supersedesId:null,confirmedBy:null,confirmedAt:null});
c.conversationPhase='review';await store.updateCase(c);await submitCase(domain,tenant,c.id,{acknowledgeIncomplete:true});
const original=await store.listHandoffs(tenant.id,c.id);
const app=createApp(deps);registerStaffRoutes(app,deps);registerPages(app,deps);const server=http.createServer(app);await new Promise(r=>server.listen(4319,'127.0.0.1',r));
let browser,page,errors=[],checks=0;function check(name,value=true){assert.ok(value,name);checks++;console.log('PASS '+name);}
try{
 browser=await launchAcceptanceBrowser();page=await browser.newPage();await page.setViewport({width:390,height:844});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(deps.baseUrl+'/staff?business='+tenant.slug,{waitUntil:'networkidle0'});await page.waitForSelector('#slug',{visible:true});
 check('legacy staff URL canonicalizes and remembers the business',new URL(page.url()).pathname==='/staff/'&&await page.$eval('#slug',e=>e.value)===tenant.slug);
 await page.type('#email','tech@demo-phoenix.invalid');await page.type('#pw','demo-tech-1234');await page.click('#go');await page.waitForSelector('.inbox-row');
 check('phone login opens submitted requests');await page.click('.inbox-row');await page.waitForSelector('#visitPanel');
 check('phone detail opens with contact action and booking controls',await page.$eval('#visitPanel',e=>e.textContent.includes('Email customer')));
 await page.type('#jobNote','Unsent synthetic field note');await page.waitForFunction(()=>document.querySelector('#jobNoteStatus').textContent.includes('saved on this phone'));
 await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('#jobNote');await page.waitForFunction(()=>document.querySelector('#jobNote').value==='Unsent synthetic field note');
 check('session and unsent note restore on relaunch');
 let lose=true;await page.setRequestInterception(true);page.on('request',async req=>{if(lose&&req.method()==='POST'&&req.url().endsWith('/action')&&JSON.parse(req.postData()||'{}').kind==='note'){lose=false;const r=await fetch(req.url(),{method:'POST',headers:req.headers(),body:req.postData()});await r.arrayBuffer();return req.abort();}req.continue();});
 await page.click('#saveJobNote');await page.waitForFunction(()=>document.querySelector('#jobNoteStatus').textContent.includes('Connection lost'));await page.click('#saveJobNote');
 await page.waitForFunction(()=>document.querySelector('#jobNotes').textContent.includes('Unsent synthetic field note')&&document.querySelector('#jobNote').value==='');
 check('lost save response reconciles without duplicate notes',(await store.listEvents(tenant.id,c.id)).filter(e=>e.type==='staff_note').length===1);
 await page.$eval('#visitPanel summary',e=>e.click());
 const date=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
 await page.$eval('#visitStart',(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));},date+'T10:00');await page.$eval('#visitEnd',(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));},date+'T11:00');
 await page.select('#visitReminder','');
 await page.click('#saveVisit');await page.waitForFunction(()=>document.querySelector('#visitPanel summary').textContent.includes('Appointment ·'));
 check('booking persists a real Phoenix appointment',(await store.listAppointments(tenant.id))[0].startsAt===date+'T17:00:00.000Z');
 check('no-reminder choice stays off when reopening the appointment',await page.$eval('#visitReminder',e=>e.value)==='');
 await page.click('#tabCalendar');await page.waitForSelector('#scheduleDate');await page.$eval('#scheduleDate',(e,v)=>{e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));},date);await page.waitForSelector('.appointment-row');
 check('day calendar displays booked jobs');await page.screenshot({path:'/tmp/mendcue-technician-calendar.png'});
 await page.evaluate(()=>[...document.querySelectorAll('#calendar button')].find(e=>e.textContent==='Week view').click());await page.waitForSelector('.appointment-row');check('week calendar displays booked jobs');
 await page.click('.appointment-row');await page.waitForSelector('#cancelVisit');await page.click('#cancelVisit');await page.waitForFunction(()=>document.querySelector('#visitPanel summary').textContent==='Book an appointment');
 check('cancelling a visit removes its calendar slot',!(await store.listAppointments(tenant.id))[0].active);
 check('technician actions preserve the original submitted evidence',JSON.stringify(await store.listHandoffs(tenant.id,c.id))===JSON.stringify(original));
 await page.setViewport({width:320,height:640});await page.screenshot({path:'/tmp/mendcue-technician-phone.png'});check('320px app has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.click('#tabSettings');await page.waitForSelector('#notificationStatus');check('notification setup remains explicit',await page.$eval('#notificationStatus',e=>/not configured|not supported/.test(e.textContent)));
 const scope=await page.evaluate(async()=>{const r=await navigator.serviceWorker.ready;return new URL(r.scope).pathname;});check('service worker controls only the staff app',scope==='/staff/');
 const keys=await page.evaluate(async()=>{const result=[];for(const k of await caches.keys())for(const r of await (await caches.open(k)).keys())result.push(new URL(r.url).pathname);return result;});check('offline cache contains no private responses',keys.length>0&&keys.every(k=>k.startsWith('/staff/')&&!k.includes('/api/')));
 server.closeAllConnections();await new Promise(r=>server.close(r));await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.textContent.includes('You’re offline'));check('cold offline launch shows a generic reconnect screen');
 await new Promise(r=>server.listen(4319,'127.0.0.1',r));
 for(let i=0;i<5;i++){await page.goto(deps.baseUrl+'/staff/',{waitUntil:'networkidle0'});if(await page.$('#statusFilter'))break;await new Promise(r=>setTimeout(r,1000));}
await page.waitForSelector('#statusFilter',{visible:true});await page.select('#statusFilter','active');await page.waitForSelector('.inbox-row');await page.click('.inbox-row');await page.waitForSelector('#jobNote');await page.type('#jobNote','Draft to clear on logout');await page.waitForFunction(()=>document.querySelector('#jobNoteStatus').textContent.includes('saved on this phone'));await page.click('#logout');await page.waitForSelector('#go',{visible:true});
 check('logout clears private UI and account drafts',await page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('mendcue-staff-drafts');r.onsuccess=()=>resolve(r.result);r.onerror=reject;});return new Promise(resolve=>{const r=db.transaction('drafts').objectStore('drafts').getAll();r.onsuccess=()=>resolve(r.result.length===0&&document.querySelector('#detail').textContent==='');});}));
 check('no browser JavaScript errors',errors.length===0);console.log(`${checks}/${checks} technician browser checks passed (synthetic fixture).`);
}catch(e){console.log('BROWSER DIAGNOSTIC',errors,await page?.evaluate(()=>({title:document.title,status:document.querySelector('#appNotice')?.textContent,loading:document.querySelector('#sessionLoading')?.textContent,login:document.querySelector('#login')?.getBoundingClientRect().height,body:document.body.textContent.slice(0,180)})));await page?.screenshot({path:'/tmp/mendcue-technician-failure.png'});throw e;}finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
