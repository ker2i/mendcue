/* Public shell only. Private APIs, photos and documents are never cached. */
const VERSION='__APP_VERSION__';
const CACHE='mendcue-staff-'+VERSION;
const PUBLIC=['/staff/offline.html','/staff/app.css?v='+VERSION,'/staff/app.js?v='+VERSION,'/staff/icon-192.png','/staff/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PUBLIC))));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('mendcue-staff-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('message',event=>{if(event.data?.type==='APPLY_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(url.origin!==self.location.origin||event.request.method!=='GET')return;
 if(event.request.mode==='navigate'&&url.pathname.startsWith('/staff/')){
  event.respondWith(fetch(event.request).catch(()=>caches.match('/staff/offline.html')));return;
 }
 if(PUBLIC.includes(url.pathname+url.search))event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
self.addEventListener('push',event=>{
 let data;try{data=event.data.json();}catch{return;}
 if(!data||!['new_brief','appointment_reminder','test'].includes(data.type)||Date.parse(data.expiresAt)<=Date.now())return;
 const caseId=typeof data.caseId==='string'&&/^[0-9a-f-]{36}$/i.test(data.caseId)?data.caseId:null;
 event.waitUntil(self.registration.showNotification('MendCue',{
  body:data.type==='appointment_reminder'?'An appointment is coming up. Open the app to review.':data.type==='test'?'Test notification. Your device is connected.':'New service brief. Open the app to review.',
  icon:'/staff/icon-192.png',badge:'/staff/icon-192.png',tag:'mendcue-'+String(data.eventId),data:{caseId}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const caseId=event.notification.data?.caseId;
 const target='/staff/'+(typeof caseId==='string'&&/^[0-9a-f-]{36}$/i.test(caseId)?'#case='+caseId:'');
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
  const client=clients.find(c=>new URL(c.url).origin===self.location.origin&&new URL(c.url).pathname.startsWith('/staff/'));
  if(client){await client.focus();client.postMessage({type:'OPEN_CASE',caseId});}else await self.clients.openWindow(target);
 }));
});
