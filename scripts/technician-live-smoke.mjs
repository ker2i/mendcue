// Owner-authorized production smoke against a previously recorded SYNTHETIC case.
// Reads credentials from the private operator directory; never prints them.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {launchAcceptanceBrowser} from './browser-launch.mjs';
const owner=JSON.parse(await readFile('/home/zemmli/.config/mendcue/quickfix-owner.json','utf8'));
const synthetic=JSON.parse(await readFile('/home/zemmli/.config/mendcue/live-smoke-result.json','utf8'));
const base='https://intake.quickfixphx.com',browser=await launchAcceptanceBrowser();
try{
 const page=await browser.newPage();await page.setViewport({width:390,height:844});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/staff/?business=quickfix-phoenix#case='+synthetic.caseId,{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#go',{visible:true});await page.type('#email',owner.email);await page.type('#pw',owner.password);await page.click('#go');await page.waitForSelector('#visitPanel');
 async function api(path,method='GET',body){return page.evaluate(async({path,method,body})=>{const csrf=decodeURIComponent(document.cookie.match(/(?:^|; )staff_csrf=([^;]+)/)?.[1]||'');const r=await fetch('/api/v1/staff/'+path,{method,headers:{'content-type':'application/json','x-csrf-token':csrf},body:body?JSON.stringify(body):undefined,cache:'no-store'});const j=await r.json();return {status:r.status,body:j};},{path,method,body});}
 const detail=(await api('cases/'+synthetic.caseId)).body,original=detail.case.workflowStatus;
 assert.ok(!detail.appointment?.active,'Synthetic case already has an appointment; do not overwrite it');assert.ok(!['closed','cancelled'].includes(original));
 const me=(await api('me')).body;let version=detail.case.version;
 const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
 const body={kind:'appointment',version,clientMutationId:crypto.randomUUID(),startsLocal:date+'T10:00',endsLocal:date+'T10:30',technicianId:me.user.id,note:'Synthetic technician app verification; cancelled after check.',reminderMinutes:null};
 const booked=await api('cases/'+synthetic.caseId+'/action','POST',body);assert.equal(booked.status,200);version=booked.body.version;
 const replay=await api('cases/'+synthetic.caseId+'/action','POST',body);assert.equal(replay.body.version,version);console.log('PASS live owner login, appointment booking and idempotent replay');
 await page.click('#tabCalendar');await page.waitForSelector('#scheduleDate');await page.$eval('#scheduleDate',(e,date)=>{e.value=date;e.dispatchEvent(new Event('change',{bubbles:true}));},date);
 await page.waitForSelector('.appointment-row');assert.match(await page.$eval('#scheduleList',e=>e.textContent),new RegExp(synthetic.reference));await page.screenshot({path:'docs/screenshots/technician-live-calendar.png'});
 console.log('PASS live mobile calendar and business timezone');
 const cancelled=await api('cases/'+synthetic.caseId+'/action','POST',{kind:'unschedule',version,clientMutationId:crypto.randomUUID()});assert.equal(cancelled.status,200);version=cancelled.body.version;
 const restored=await api('cases/'+synthetic.caseId+'/action','POST',{kind:'workflow',status:original,version,clientMutationId:crypto.randomUUID()});assert.equal(restored.status,200);
 const config=(await api('push/config')).body;assert.equal(config.enabled,true);assert.ok(config.publicKey);
 const sw=await page.evaluate(async()=>new URL((await navigator.serviceWorker.ready).scope).pathname);assert.equal(sw,'/staff/');assert.deepEqual(errors,[]);
 const final=(await api('cases/'+synthetic.caseId)).body;assert.deepEqual(final.handoffs,detail.handoffs);assert.equal(final.appointment.active,false);assert.equal(final.case.workflowStatus,original);
 console.log('PASS live appointment cleanup, immutable handoff, HTTPS app worker and notification configuration');
 console.log('Physical Android installation and device delivery not exercised. No Meta calls made.');
}finally{await browser.close();}
