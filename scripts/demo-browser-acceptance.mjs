// Real-browser verification of the browser-only GitHub Pages product demo.
import http from 'node:http';
import { readFile, mkdir, writeFile, mkdtemp, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { launchAcceptanceBrowser, browserUploadPath, browserDownloadDirectory } from './browser-launch.mjs';
const root=fileURLToPath(new URL('../demo-site/',import.meta.url));
const screenshots=process.env.SCREENSHOT_DIR||fileURLToPath(new URL('../docs/screenshots/',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf'};
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(!url.pathname.startsWith('/mendcue/')){res.writeHead(404);res.end();return;}
    const relative=decodeURIComponent(url.pathname.slice('/mendcue/'.length))||'index.html';
    if(relative.split('/').includes('..')){res.writeHead(403);res.end();return;}
    const content=await readFile(join(root,relative));res.writeHead(200,{'content-type':types[extname(relative)]||'application/octet-stream'});res.end(content);
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/mendcue/`;
const browser=await launchAcceptanceBrowser();
let checks=0;
function check(name,condition){if(!condition)throw new Error('FAIL '+name);checks++;console.log('PASS '+name);}
try {
  await mkdir(screenshots,{recursive:true});
  const page=await browser.newPage();await page.setViewport({width:1440,height:900});
  const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)errors.push(r.url()+' '+r.status());});
  page.on('request',r=>{if(!r.url().startsWith(new URL(base).origin)&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))external.push(r.url());});
  await page.goto(base,{waitUntil:'networkidle0'});await page.evaluate(()=>document.fonts.ready);
  check('loads under GitHub project subpath',await page.$eval('h1',e=>e.textContent.includes('Better prepared.')));
  await page.screenshot({path:join(screenshots,'demo-desktop.png'),fullPage:true});
  await page.screenshot({path:join(screenshots,'demo-hero.png')});
  check('visible scripted-demo disclosure',await page.$eval('.workspace-footnote',e=>e.textContent.includes('no live AI calls')));
  await page.click('#reply-choices button:nth-child(1)');await page.click('#reply-choices button:nth-child(2)');await page.click('#reply-choices button:nth-child(1)');
  check('three useful questions lead to editable review',await page.$eval('#review-form-wrap',e=>!e.hidden));
  await page.type('#customer-note','<img src=x onerror="window.demoXss=1">');await page.click('#note-form button');
  check('visitor note renders inertly',await page.evaluate(()=>!window.demoXss&&!document.querySelector('#conversation img')));
  await page.type('#identity-brand','Sample brand');await page.type('#identity-model','MC-W400.A1');await page.type('#identity-serial','SER-123456789');await page.click('#identity-confirmed');
  const photo=join(await mkdtemp(join(tmpdir(),'mendcue-static-')),'synthetic.png');
  await writeFile(photo,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
  await (await page.$('#label-photo')).uploadFile(await browserUploadPath(browser,photo));
  await page.waitForFunction(()=>!document.getElementById('label-preview').hidden&&document.getElementById('label-preview').naturalWidth>0);
  check('local photograph preview works',true);
  await page.click('#identity-form button[type=submit]');
  check('explicit submit opens technician brief',await page.$eval('#tab-technician',e=>e.getAttribute('aria-selected')==='true'));
  const brief=await page.$eval('#brief-content',e=>e.innerText);
  check('brief includes selected observations and exact model suffix',brief.includes('Water is still standing')&&brief.includes('MC-W400.A1')&&brief.includes('OE'));
  check('serial does not replace model',brief.includes('SER-123456789')&&brief.includes('MC-W400.A1'));
  await page.click('.brief-source');check('source viewer states actual applicability',await page.$eval('#source-dialog',e=>e.open&&e.innerText.includes('No manufacturer document')));await page.keyboard.press('Escape');
  await page.click('.brief-actions .button-dark');check('local technician approval works',await page.$eval('.brief-badge',e=>e.innerText.includes('Approved in demo')));
  const download=await browserDownloadDirectory(browser,await mkdtemp(join(tmpdir(),'mendcue-download-')));const downloads=download.localPath;const cdp=await page.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:download.browserPath});
  await page.evaluate(()=>[...document.querySelectorAll('.brief-actions button')].find(e=>e.textContent.includes('Download')).click());
  let file;for(let n=0;n<30;n++){file=(await readdir(downloads)).find(f=>f.endsWith('.json'));if(file)break;await new Promise(resolve=>setTimeout(resolve,100));}
  const exported=JSON.parse(await readFile(join(downloads,file),'utf8'));
  check('JSON export preserves evidence and demo labels',exported.demo&&exported.identity.model==='MC-W400.A1'&&exported.observations.length===3&&exported.photo.includes('excluded'));
  await page.evaluate(()=>[...document.querySelectorAll('.brief-actions button')].find(e=>e.textContent==='Edit intake').click());
  await page.type('#identity-model','X');check('identity corrections revoke confirmation',await page.$eval('#identity-confirmed',e=>!e.checked));
  await page.click('[data-scenario=fridge]');check('scenario switch clears previous answers and photo',await page.$eval('#label-preview',e=>e.hidden)&&(await page.$$eval('#reply-choices button',e=>e.length))===3);
  await page.click('#reply-choices button:nth-child(1)');await page.click('#reply-choices button:nth-child(2)');await page.click('#reply-choices button:nth-child(3)');await page.click('#tab-technician');
  check('refrigerator brief reflects scope and unknown display',await page.$eval('#brief-content',e=>e.innerText.includes('Refrigerator only')&&e.innerText.includes('I can’t safely check')));
  await page.click('[data-scenario=safety]');check('hazard pauses questions and persists a safety notice',await page.$eval('#safety-notice',e=>!e.hidden)&&(await page.$$eval('#reply-choices button',e=>e.length))===0);
  await page.click('#identity-form button[type=submit]');check('hazard brief offers urgent review instead of routine approval',await page.$eval('.brief-actions .button-dark',e=>e.innerText.includes('urgent')));
  await page.focus('#tab-technician');await page.keyboard.press('ArrowLeft');check('tabs support keyboard arrow navigation',await page.$eval('#tab-customer',e=>e.getAttribute('aria-selected')==='true'));
  await page.click('[data-scenario=washer]');
  for(const width of [390,320]){await page.setViewport({width,height:844,isMobile:true});check(`${width}px page has no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  const phone=await browser.newPage();await phone.setViewport({width:390,height:844,isMobile:true,deviceScaleFactor:1});
  await phone.goto(base,{waitUntil:'networkidle0'});await phone.evaluate(()=>document.fonts.ready);
  await phone.screenshot({path:join(screenshots,'demo-phone.png'),fullPage:true});
  await phone.$eval('#demo',e=>window.scrollTo({top:e.offsetTop,behavior:'instant'}));await phone.screenshot({path:join(screenshots,'demo-phone-interaction.png')});
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);check('reduced motion disables smooth scrolling',await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior==='auto'));
  check('no runtime or missing-asset errors',errors.length===0);
  check('no third-party requests or model calls',external.length===0);
  console.log(`\n${checks}/${checks} static demo checks passed.`);
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
