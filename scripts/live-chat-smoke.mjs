// Public-site smoke check. Uses only synthetic text; one turn can call live Meta.
import assert from 'node:assert/strict';
import {launchAcceptanceBrowser} from './browser-launch.mjs';
const browser=await launchAcceptanceBrowser();
try {
  const page=await browser.newPage();
  await page.setViewport({width:1440,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://quickfixphx.com',{waitUntil:'networkidle0'});
  await page.waitForSelector('[data-mendcue-open]',{visible:true});
  await page.click('[data-mendcue-open]');
  await page.waitForSelector('#mendcue-frame-wrap iframe');
  const frame=await (await page.$('#mendcue-frame-wrap iframe')).contentFrame();
  try { await frame.waitForFunction(()=>document.querySelector('#in')&&!document.querySelector('#in').disabled); } catch(error) { console.log('BOOT DIAGNOSTIC',await frame.evaluate(()=>({status:document.querySelector('#status')?.textContent,hasNewLayout:!!document.querySelector('.chat-sheet'),scripts:[...document.scripts].map(s=>new URL(s.src).pathname)})),errors); await page.screenshot({path:'/tmp/mendcue-live-boot.png'}); throw error; }
  assert.match(await frame.$eval('#log',e=>e.textContent),/QuickFIX's AI repair assistant/);
  assert.ok(await frame.$eval('#conversation',e=>e.clientHeight>300));
  await page.screenshot({path:'docs/screenshots/quickfix-chat-desktop.png'});
  await frame.type('#in','Hello!');await frame.click('#send');
  await frame.waitForFunction(()=>/Hi there!/.test(document.querySelector('#log').textContent));
  console.log('PASS live welcome and polite greeting');
  await frame.type('#in','My washer fills with water but does not drain.');await frame.click('#send');
  await frame.waitForFunction(()=>!document.querySelector('#thinking').hidden);
  await frame.type('#in','85003');
  await frame.waitForFunction(()=>document.querySelector('#thinking').hidden&&/ZIP/.test(document.querySelector('#log').textContent),{timeout:90000});
  assert.equal(await frame.$eval('#in',e=>e.value),'85003');
  console.log('PASS live queued reply and preserved draft');
  await page.setViewport({width:390,height:844});
  await page.waitForFunction(()=>{const r=document.querySelector('#mendcue-frame-wrap').getBoundingClientRect();return r.right<=390&&r.bottom<=844;});
  await frame.evaluate(()=>{const e=document.querySelector('#conversation');e.scrollTop=e.scrollHeight;});
  await page.screenshot({path:'docs/screenshots/quickfix-chat-phone.png'});
  assert.ok(await frame.$eval('#in',e=>{const r=e.getBoundingClientRect();return r.width>100&&r.bottom<=innerHeight;}));
  assert.deepEqual(errors,[]);
  console.log('PASS live phone layout and no page errors');
} finally {await browser.close();}
