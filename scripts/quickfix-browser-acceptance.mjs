// Actual QuickFIX page -> cross-origin widget -> review -> technician inbox.
// Uses temporary memory/media and explicit fixtures; no live API or production SQL.
import http from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore } from '../dist/db/memory.js';
import { seedStore } from '../dist/db/seed.js';
import { FixtureProvider } from '../dist/integrations/meta/fixture.js';
import { FilesystemStorage } from '../dist/integrations/storage/storage.js';
import { createApp } from '../dist/server/app.js';
import { registerPages } from '../dist/server/pages.js';
import { registerStaffRoutes } from '../dist/server/staff.js';
import { processOneJob } from '../dist/worker/worker.js';
import { launchAcceptanceBrowser } from './browser-launch.mjs';

process.env.NODE_ENV = 'test';
process.env.SYNC_TURNS = '1';
const base = 'http://localhost:4318';
const key = 'pk_quickfix_browser_fixture_001';
const store = new MemoryStore();
await seedStore(store);
const tenant = await store.getTenantBySlug('demo-phoenix-appliance');
await store.saveTenant({...tenant, publicKey:key});
const media = await mkdtemp(join(tmpdir(),'mendcue-quickfix-'));
const deps = {store,provider:new FixtureProvider(),storage:new FilesystemStorage(media),baseUrl:base};
const app = createApp(deps);
registerStaffRoutes(app,deps); registerPages(app,deps);
const serve = (server,port) => new Promise((resolve,reject) => {server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
const stop = server => new Promise(resolve => {if(!server.listening) return resolve();server.close(resolve);server.closeAllConnections();});
const api = http.createServer(app);
let enabled = true;
const site = http.createServer(async (req,res) => {
  try {
    const path = new URL(req.url,'http://localhost').pathname;
    if (path === '/mendcue-config.json') {
      res.setHeader('content-type','application/json');
      return res.end(JSON.stringify({enabled,backendOrigin:base,publicKey:key,tenantSlug:tenant.slug}));
    }
    const relative = path === '/' ? 'index.html' : path.slice(1);
    if (relative.split('/').some(x=>x.startsWith('.'))) {res.writeHead(404);return res.end();}
    const body = await readFile(new URL('../quickfix-site/'+relative,import.meta.url));
    res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(relative)]||'text/plain');
    res.end(body);
  } catch {res.writeHead(404);res.end();}
});
let browser;
let checks = 0;
function check(name,pass) {if(!pass) throw Error(name);checks++;console.log('PASS '+name);}
try {
  await serve(api,4318); await serve(site,3100);
  browser = await launchAcceptanceBrowser();
  const page = await browser.newPage();
  await page.setViewport({width:1440,height:900});
  const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:3100',{waitUntil:'networkidle0'});
  await page.waitForSelector('[data-mendcue-open]',{visible:true});
  check('website connection enables repair request button',true);
  let failNext=true, loseReplyOnce=false, pollReads=0, blockLoader=false, blockConfig=false;
  const retryKeys=[];
  await page.setRequestInterception(true);
  page.on('request',async req=>{
    if(blockLoader && new URL(req.url()).pathname==='/mendcue-widget.js') return req.abort();
    if(blockConfig && new URL(req.url()).pathname==='/mendcue-config.json') return req.abort();
    if(failNext && req.url()===base+'/api/v1/public/sessions' && req.method()==='POST') {failNext=false;return req.abort();}
    if(req.url().includes('/api/v1/cases/') && req.method()==='GET') pollReads++;
    if(req.url().endsWith('/messages') && (req.postData()||'').includes('Hello!')) {
      retryKeys.push(req.headers()['idempotency-key']);
      if(loseReplyOnce) {loseReplyOnce=false; const r=await fetch(req.url(),{method:'POST',headers:req.headers(),body:req.postData()});await r.arrayBuffer();return req.abort();}
    }
    req.continue();
  });
  await page.click('[data-mendcue-open]');
  await page.waitForFunction(()=>document.querySelector('#mendcue-frame-wrap')?.textContent.includes('Try again'));
  check('connection failure offers retry and contact guidance',true);
  await page.evaluate(()=>Array.from(document.querySelectorAll('#mendcue-frame-wrap button')).find(b=>b.textContent==='Try again').click());
  await page.waitForSelector('#mendcue-frame-wrap iframe');
  const frame=await page.waitForFrame(f=>f.url().includes('/embed'));
  await frame.waitForSelector('#in');
  await frame.waitForFunction(()=>document.querySelector('#biz').textContent.includes('Demo Phoenix'));
  check('cross-origin widget bootstraps the correct tenant',true);
  await frame.waitForFunction(()=>document.querySelector('#fixture').textContent.length>0);
  check('fixture mode remains visibly labeled',true);
  await page.bringToFront();await page.screenshot({path:'/tmp/mendcue-chat-after-desktop.png'});
  check('greeting explains the assistant and invites a reply',await frame.$eval('#log',e=>/Hi!/.test(e.textContent)&&/technician/.test(e.textContent)&&/Which appliance/.test(e.textContent)));
  check('conversation has real space and the composer stays on one row',await frame.evaluate(()=>document.querySelector('#conversation').clientHeight>300&&document.querySelector('#in').tagName==='TEXTAREA'));
  const iframeUrl=frame.url();
  check('iframe URL contains no session credentials',!/[?&](code|token)=/.test(iframeUrl));
  await page.click('#mendcue-frame-wrap > button');
  check('close hides the assistant',await page.$eval('#mendcue-frame-wrap',el=>el.hidden));
  await page.click('[data-mendcue-open]');
  check('reopening preserves the same iframe and conversation',page.frames().includes(frame));
  // Lose a response after the backend commits, then retry the identical turn.
  loseReplyOnce=true;
  await frame.type('#in','Hello!');await frame.click('#send');
  await frame.waitForSelector('#retryMessage');
  await frame.click('#retryMessage');
  await frame.waitForFunction(()=>document.querySelector('#thinking').hidden&&document.querySelector('#log').textContent.includes('Hi there!'));
  check('retry reuses the same idempotency key after a lost response',retryKeys.length===2&&retryKeys[0]===retryKeys[1]);
  check('retry displays the customer message once',await frame.$$eval('.msg-c .bubble',els=>els.filter(e=>e.textContent==='Hello!').length===1));

  // Returning customers can replace an unfinished conversation with a clean request.
  const returningCase=await frame.evaluate(()=>JSON.parse(sessionStorage.getItem('mendcue:demo-phoenix-appliance')).caseId);
  await frame.evaluate(()=>location.reload());
  await frame.waitForFunction(()=>document.querySelector('#newRequestBtn')&&!document.querySelector('#newRequestBtn').disabled&&/Hi there!/.test(document.querySelector('#log').textContent));
  await frame.type('#in','Old unsent draft');
  await frame.click('#newRequestBtn');
  await frame.waitForFunction(old=>{const s=JSON.parse(sessionStorage.getItem('mendcue:demo-phoenix-appliance'));return s&&s.caseId!==old&&!document.querySelector('#in').disabled;},{},returningCase);
  check('returning customer can start a new request from the toolbar',await frame.$eval('#newRequestBtn',e=>!e.disabled&&e.getBoundingClientRect().height>0));
  check('new request resets history, draft, consent and repair facts',await frame.evaluate(()=>!document.querySelector('.msg-c')&&!document.querySelector('#in').value&&!document.querySelector('#consentBox').checked&&!document.querySelector('#detailsBody').textContent.includes('Washer')));
  check('starting fresh preserves the previous request on the server',(await store.listMessages(tenant.id,returningCase)).some(m=>m.body==='Hello!'));

  // Hold a real queued job while testing drafts, reload and extended polling.
  process.env.SYNC_TURNS='0';
  await frame.type('#in','My washer fills then stops. It is an LG and says OE.');
  const queued=page.waitForResponse(r=>r.url().endsWith('/messages')&&r.status()===202);
  await frame.click('#send');await queued;
  await frame.type('#in','85003');await page.keyboard.press('Enter');
  check('a draft can be typed while a reply is pending, without sending twice',await frame.evaluate(()=>document.querySelector('#send').disabled&&document.querySelector('#in').value==='85003'));
  await frame.evaluate(()=>{const k='mendcue:demo-phoenix-appliance';const s=JSON.parse(sessionStorage.getItem(k));s.turn.createdAt-=60000;sessionStorage.setItem(k,JSON.stringify(s));});
  await Promise.all([frame.waitForNavigation({waitUntil:'domcontentloaded'}),frame.evaluate(()=>location.reload())]);
  await frame.waitForFunction(()=>!document.querySelector('#in').disabled&&document.querySelector('#in').value==='85003');
  check('reload restores the unsent draft and pending conversation',true);
  await frame.evaluate(()=>{const real=window.setTimeout;window.setTimeout=(fn,ms,...args)=>real(fn,ms===2000?30:ms,...args);});
  const readStart=pollReads;
  while(pollReads-readStart<24) await new Promise(r=>setTimeout(r,100));
  check('queued replies continue beyond the former polling limit',await frame.evaluate(()=>!document.querySelector('#thinking').hidden&&document.querySelector('#send').disabled&&/longer/.test(document.querySelector('#status').textContent)));
  await processOneJob(deps);
  await frame.waitForFunction(()=>document.querySelector('#thinking').hidden&&document.querySelector('#log').textContent.includes('ZIP code'));
  check('late reply appears without erasing the next draft',await frame.$eval('#in',e=>e.value==='85003'));
  check('category extraction does not cover the conversation with an identity form',await frame.$eval('#cardBox',e=>e.childElementCount===0));
  process.env.SYNC_TURNS='1';
  for(const body of ['85003','jane@example.com','Done — show my review']) {
    await frame.waitForFunction(()=>!document.querySelector('#in').disabled && document.querySelector('#thinking').hidden);
    await frame.$eval('#in',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));});
    await frame.type('#in',body);
    const reply=page.waitForResponse(r=>r.url().endsWith('/messages')&&r.request().method()==='POST');
    await frame.click('#send');await reply;
  }
  await frame.waitForSelector('#reviewBox',{visible:true});
  await frame.click('#reviewBody .btn-primary');
  await frame.waitForFunction(()=>/reference is AI-/.test(document.querySelector('#reviewBody').textContent));
  const reference=await frame.$eval('#reviewBody',e=>e.textContent.match(/reference is (AI-[A-Z0-9]+)/)[1]);
  check('customer submits reviewed request and receives a reference',!!reference);
  const staff=await browser.newPage();
  await staff.goto(base+'/staff',{waitUntil:'domcontentloaded'});
  await staff.waitForSelector('#slug',{visible:true});
  await staff.type('#slug','demo-phoenix-appliance');await staff.type('#email','tech@demo-phoenix.invalid');await staff.type('#pw','demo-tech-1234');await staff.click('#go');
  await staff.waitForFunction(ref=>document.querySelector('#inbox')?.textContent.includes(ref),{},reference);
  check('submitted request reaches authenticated technician inbox',true);
  await page.setViewport({width:320,height:640});
  await page.bringToFront();
  await page.waitForFunction(()=>{const r=document.querySelector('#mendcue-frame-wrap').getBoundingClientRect();return r.right<=320&&r.bottom<=640;});
  check('assistant fits a 320px phone viewport',await page.$eval('#mendcue-frame-wrap',e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=320&&r.top>=0&&r.bottom<=640;}));
  await page.bringToFront();await page.screenshot({path:'/tmp/mendcue-chat-after-phone.png'});
  const previousCase=await frame.evaluate(()=>JSON.parse(sessionStorage.getItem('mendcue:demo-phoenix-appliance')).caseId);
  await frame.click('#newRequest');
  await frame.waitForFunction(old=>{const s=JSON.parse(sessionStorage.getItem('mendcue:demo-phoenix-appliance'));return s&&s.caseId!==old&&!document.querySelector('#in').disabled;},{},previousCase);
  check('customer can start a fresh request after submitting',true);
  check('widget loader comes from the website origin',await page.evaluate(()=>[...document.scripts].some(s=>s.src.includes('/mendcue-widget.js')&&new URL(s.src).origin===location.origin)));
  blockLoader=true;
  await page.reload({waitUntil:'networkidle0'});
  check('blocked widget leaves a working hosted repair link',await page.$eval('[data-mendcue-open]',(e,base)=>!e.hidden&&e.href===base+'/business/demo-phoenix-appliance',base));
  blockConfig=true;
  await page.reload({waitUntil:'networkidle0'});
  check('failed configuration keeps the static repair link available',await page.$eval('[data-mendcue-open]',e=>!e.hidden&&e.href==='https://intake.quickfixphx.com/business/quickfix-phoenix'));
  blockLoader=false;blockConfig=false;
  enabled=false;
  await page.reload({waitUntil:'networkidle0'});
  check('unconfigured website keeps chat hidden and phone contact available',await page.evaluate(()=>document.querySelector('[data-mendcue-open]').hidden&&!document.querySelector('#mendcue-frame-wrap')&&!!document.querySelector('a[href="tel:+17739215655"]')));
  check('no browser JavaScript errors',errors.length===0);
  console.log(`${checks}/${checks} QuickFIX browser checks passed (synthetic fixture).`);
} finally {
  if(browser) await browser.close();
  await Promise.all([stop(api),stop(site)]);
  await rm(media,{recursive:true,force:true});
}
