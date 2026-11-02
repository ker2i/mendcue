// Technician app: scheduling, drafts, installation and device notifications.
(function(){
 'use strict';
 var api=null,account=null,team=[],timezone='America/Phoenix',installPrompt=null,registration=null,applyUpdate=false;
 var draftPromises=new Set(),pendingActions=new Map(),generation=0;
 var notice=function(text){document.getElementById('appNotice').textContent=text||'';};
 function el(tag,text,cls){var n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
 function button(text,fn,cls){var b=el('button',text,cls||'btn');b.type='button';b.onclick=fn;return b;}
 function headers(){var c=document.cookie.match(/(?:^|; )staff_csrf=([^;]+)/);return {'content-type':'application/json','x-csrf-token':c?decodeURIComponent(c[1]):''};}
 async function request(path,options){var g=generation,r=await fetch('/api/v1/staff/'+path,Object.assign({cache:'no-store',signal:AbortSignal.timeout(15000)},options));if(g!==generation)throw Error('Account changed');if(r.status===401){api.expire();throw Error('Sign in again to continue.');}var j=await r.json();if(!r.ok){var e=Error(j.error?.message||'Could not save. Try again.');e.code=j.error?.code;e.status=r.status;throw e;}return j;}
 function local(time){var parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time));var p=function(k){return parts.find(p=>p.type===k).value;};return p('year')+'-'+p('month')+'-'+p('day')+'T'+p('hour')+':'+p('minute');}
 function utc(value){var target=Date.parse(value+'Z'),time=target;for(var i=0;i<3;i++)time+=target-Date.parse(local(time)+'Z');return new Date(time).toISOString();}
 function pretty(time){return new Intl.DateTimeFormat(undefined,{timeZone:timezone,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(time));}
 function key(caseId,kind){return account.id+':'+account.userId+':'+caseId+':'+kind;}
 var database=new Promise(function(resolve,reject){try{var r=indexedDB.open('mendcue-staff-drafts',1);r.onupgradeneeded=function(){r.result.createObjectStore('drafts',{keyPath:'key'});};r.onsuccess=function(){resolve(r.result);};r.onerror=function(){reject(Error('Draft storage unavailable'));};}catch(e){reject(e);}});
 database.catch(function(){});
 async function records(){var db=await database;return new Promise(function(resolve,reject){var r=db.transaction('drafts').objectStore('drafts').getAll();r.onsuccess=function(){resolve(r.result);};r.onerror=function(){reject(r.error);};});}
 async function write(record){var db=await database;return new Promise(function(resolve,reject){var tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(record);tx.oncomplete=resolve;tx.onerror=function(){reject(tx.error);};});}
 async function remove(keys){var db=await database;return new Promise(function(resolve,reject){var tx=db.transaction('drafts','readwrite');keys.forEach(function(k){tx.objectStore('drafts').delete(k);});tx.oncomplete=resolve;tx.onerror=function(){reject(tx.error);};});}
 async function getDraft(k){var all=await records(),expired=all.filter(r=>r.createdAt+86400000<Date.now());if(expired.length)await remove(expired.map(r=>r.key));return all.find(r=>r.key===k&&r.createdAt+86400000>=Date.now());}
 // Serialize writes: capacity checks and input updates cannot overwrite newer drafts.
 var draftChain=Promise.resolve();
 function saveDraft(k,data){var savedAccount=account,queued=draftChain.catch(function(){}).then(async function(){
  if(!savedAccount||savedAccount!==account)return;var all=await records(),old=all.find(r=>r.key===k),record={key:k,owner:savedAccount.id+':'+savedAccount.userId,createdAt:old?.createdAt||Date.now(),updatedAt:Date.now(),data:data};
  var active=all.filter(r=>r.createdAt+86400000>=Date.now()&&r.key!==k);
  if(active.length>=20||new TextEncoder().encode(JSON.stringify(active.concat(record))).length>262144)throw Error('Draft storage is full. This edit is kept in this screen only.');
  await write(record);
 });draftChain=queued;draftPromises.add(queued);queued.finally(function(){draftPromises.delete(queued);}).catch(function(){});return queued;}
 function field(box,label,type,value,id){var l=el('label',label),input=el(type==='textarea'?'textarea':type==='select'?'select':'input');if(!['textarea','select'].includes(type))input.type=type;if(id)input.id=id;if(type!=='select')input.value=value||'';l.appendChild(input);box.appendChild(l);return input;}
 function options(select,rows,value){rows.forEach(function(r){var o=el('option',r[1]);o.value=r[0];select.appendChild(o);});select.value=value;}
 function showTab(tab){api.state.tab=tab;document.getElementById('inboxPane').style.display=tab==='inbox'?'':'none';document.getElementById('calendar').style.display=tab==='calendar'?'block':'none';document.getElementById('settings').style.display=tab==='settings'?'block':'none';document.getElementById('deviceSettings').style.display=tab==='settings'?'block':'none';window.scrollTo(0,0);}
 async function runAction(c,kind,fields,status,b){
  var k=key(c.id,kind),body=pendingActions.get(k),changed=Object.assign({kind:kind},fields);
  if(body&&JSON.stringify(Object.assign({},body,{version:undefined,clientMutationId:undefined}))!==JSON.stringify(changed)){status.textContent='Retry the previous action or refresh the request before saving different details.';return;}
  if(!body){body=Object.assign({},changed,{version:c.version,clientMutationId:crypto.randomUUID()});pendingActions.set(k,body);}
  b.disabled=true;status.textContent='Saving…';
  try{
   await saveDraft(k,{pending:body}).catch(function(){status.textContent="Draft storage unavailable. Saving this action online…";});
   var result;
   try{result=await request('cases/'+c.id+'/mutations/'+body.clientMutationId);}catch(e){if(e.status!==404)throw e;}
   if(!result)result=await request('cases/'+c.id+'/action',{method:'POST',headers:headers(),body:JSON.stringify(body)});
   pendingActions.delete(k);await remove([k]).catch(function(){});c.version=result.version;status.textContent='Saved.';
   await api.openCase(c.id);api.loadInbox();
  }catch(e){
   status.textContent=e.message;
   if(e.status===409&&e.code!=='MUTATION_ID_CONFLICT'){
    pendingActions.delete(k);await saveDraft(k,{fields:fields,conflict:true});
    status.appendChild(button('Review latest request',function(){api.openCase(c.id);}));
   }else if(!e.status){status.textContent='Connection lost. Your action is kept on this phone. Retry to check whether it was saved.';b.textContent='Retry save';}
  }finally{b.disabled=api.state.user?.role==='readonly';}
 }
 async function recoverAction(c,kind,apply,status){var g=generation;try{var saved=await getDraft(key(c.id,kind));if(g!==generation||api.state.openId!==c.id||!saved)return;var data=saved.data;if(data.pending){pendingActions.set(key(c.id,kind),data.pending);apply(data.pending);status.textContent='An earlier save needs confirmation. Press Save to check or retry the same action.';}else if(data.fields){apply(data.fields);status.textContent=data.conflict?'Unsent changes restored. Review the latest request before saving again.':'Unsent changes restored from this phone.';}}catch{status.textContent='Draft storage unavailable. Keep this screen open until saved.';}}
 function onDetail(j,d){
  var c=j.case,readonly=api.state.user.role==='readonly',a=j.appointment;
  var panel=el('section',undefined,'card visit-panel');panel.id='visitPanel';panel.appendChild(el('h3','Visit & customer'));
  var snap=j.handoffs?.at(-1)?.snapshot,contact=String(snap?.contact?.channel||'').trim();
  var actions=el('div',undefined,'job-actions');
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)){var mail=el('a','Email customer','btn');mail.href='mailto:'+encodeURIComponent(contact);actions.appendChild(mail);}
  else if(/^\+?[\d\s().-]{7,25}$/.test(contact)){var phone=contact.replace(/[^+\d]/g,'');if(/^\+?\d{7,15}$/.test(phone)){var call=el('a','Call customer','btn');call.href='tel:'+phone;actions.appendChild(call);}}
  var address=snap?.facts?.find(f=>f.key==='service_address'&&f.value)?.value;
  if(typeof address==='string'&&address.trim()){var map=el('a','Directions','btn');map.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(address);map.target='_blank';map.rel='noopener';actions.appendChild(map);}
  panel.appendChild(actions);
  var schedule=el('details');schedule.open=!!a?.active;schedule.appendChild(el('summary',a?.active?'Appointment · '+pretty(a.startsAt):'Book an appointment'));panel.appendChild(schedule);
  schedule.appendChild(el('p','All visit times are in '+timezone+'. Scheduling here does not send a customer confirmation.','muted'));
  var start=field(schedule,'Visit starts','datetime-local',a?.active?local(a.startsAt):'','visitStart');
  var end=field(schedule,'Visit ends','datetime-local',a?.active?local(a.endsAt):'','visitEnd');
  var tech=field(schedule,'Technician','select',null,'visitTechnician');options(tech,team.map(u=>[u.id,u.name]),a?.technicianId||api.state.user.id);
  var note=field(schedule,'Visit note','textarea',a?.note||'','visitNote');note.maxLength=2000;
  var reminder=field(schedule,'Phone reminder','select',null,'visitReminder');options(reminder,[['30','30 minutes before'],['15','15 minutes before'],['60','1 hour before'],['','No reminder']],a?(a.reminderMinutes===null?'':String(a.reminderMinutes)):'30');
  var status=el('p','');status.id='visitStatus';status.setAttribute('role','status');schedule.appendChild(status);
  var values=function(){return {startsLocal:start.value,endsLocal:end.value,technicianId:tech.value,note:note.value,reminderMinutes:reminder.value?Number(reminder.value):null};};
  var save=button(a?.active?'Save appointment':'Book visit',function(){runAction(c,'appointment',values(),status,save);},'btn btn-primary');save.id='saveVisit';save.disabled=readonly||!c.submittedAt;schedule.appendChild(save);
  if(a?.active){var cancel=button('Cancel appointment',function(){runAction(c,'unschedule',{},status,cancel);});cancel.id='cancelVisit';cancel.disabled=readonly;schedule.appendChild(cancel);}
  var apply=function(v){if(v.startsLocal!==undefined)start.value=v.startsLocal;if(v.endsLocal!==undefined)end.value=v.endsLocal;if(v.technicianId)tech.value=v.technicianId;if(v.note!==undefined)note.value=v.note;if(v.reminderMinutes!==undefined)reminder.value=v.reminderMinutes===null?'':String(v.reminderMinutes);};
  recoverAction(c,'appointment',apply,status);
  [start,end,tech,note,reminder].forEach(function(input){input.addEventListener('input',function(){var value=values();status.textContent='Saving draft on this phone…';saveDraft(key(c.id,'appointment'),{fields:value}).then(function(){if(JSON.stringify(value)===JSON.stringify(values()))status.textContent='Unsent appointment saved on this phone.';}).catch(function(e){status.textContent=e.message;});});});
  var quick=el('div',undefined,'job-actions');var jobStatus=el('p','');jobStatus.setAttribute('role','status');
  [['contacted','Mark contacted'],['closed','Complete job'],['cancelled','Cancel job']].forEach(function(pair){var b=button(pair[1],function(){runAction(c,'workflow',{status:pair[0]},jobStatus,b);});b.disabled=readonly||!c.submittedAt;quick.appendChild(b);});panel.append(quick,jobStatus);
  recoverAction(c,'workflow',function(){},jobStatus);
  if(a?.active)recoverAction(c,'unschedule',function(){},status);
  var notes=el('section',undefined,'card');notes.id='jobNotes';notes.appendChild(el('h3','Job notes'));
  (j.events||[]).filter(e=>e.type==='staff_note'||e.type==='staff_update'&&e.payload.note).forEach(function(e){notes.appendChild(el('p',e.payload.note));notes.appendChild(el('p',pretty(e.createdAt),'muted'));});
  var text=field(notes,'Add an internal note','textarea','','jobNote');text.maxLength=2000;var noteStatus=el('p','');noteStatus.id='jobNoteStatus';noteStatus.setAttribute('role','status');
  var add=button('Save note',function(){runAction(c,'note',{note:text.value},noteStatus,add);},'btn btn-primary');add.id='saveJobNote';add.disabled=readonly||!c.submittedAt;notes.append(add,noteStatus);
  text.addEventListener('input',function(){var value=text.value;noteStatus.textContent='Saving draft on this phone…';saveDraft(key(c.id,'note'),{fields:{note:value}}).then(function(){if(text.value===value)noteStatus.textContent='Unsent note saved on this phone.';}).catch(function(e){noteStatus.textContent=e.message;});});
  recoverAction(c,'note',function(v){text.value=v.note||'';},noteStatus);
  d.insertBefore(notes,d.children[2]||null);d.insertBefore(panel,d.children[2]||null);
  // Recover author-edited fields in the existing technician review/identity forms.
  var inputs=[...d.querySelectorAll('input,textarea,select')].filter(n=>!n.closest('#visitPanel,#jobNotes'));var edits={};
  inputs.forEach(function(n,i){var id=n.id||((n.closest('label')?.firstChild?.textContent||n.type)+':'+i);n.dataset.draftField=id;
   n.addEventListener('input',function(){edits[id]=n.type==='checkbox'?n.checked:n.value;saveDraft(key(c.id,'review-fields'),{fields:edits,baseVersion:c.version}).catch(function(e){notice(e.message);});});
  });
  var g=generation;getDraft(key(c.id,'review-fields')).then(function(record){if(g!==generation||api.state.openId!==c.id||!record)return;edits=record.data.fields||{};inputs.forEach(function(n){if(Object.hasOwn(edits,n.dataset.draftField)){if(n.type==='checkbox')n.checked=edits[n.dataset.draftField];else n.value=edits[n.dataset.draftField];}});notice('Unsent edits restored from this phone. Review them before saving.');}).catch(function(){});
 }
 var selectedDate='',calendarMode='day';
 async function calendar(){
  showTab('calendar');var box=document.getElementById('calendar');box.replaceChildren();box.appendChild(el('h2','Your schedule'));
  selectedDate=selectedDate||local(Date.now()).slice(0,10);var controls=el('div',undefined,'calendar-controls');box.appendChild(controls);
  var date=field(controls,'Date','date',selectedDate,'scheduleDate');date.onchange=function(){selectedDate=date.value;calendar();};
  var move=function(days){selectedDate=new Date(Date.parse(selectedDate+'T12:00Z')+days*86400000).toISOString().slice(0,10);calendar();};
  controls.append(button('Previous',function(){move(calendarMode==='week'?-7:-1);}),button('Today',function(){selectedDate=local(Date.now()).slice(0,10);calendar();}),button('Next',function(){move(calendarMode==='week'?7:1);}),button(calendarMode==='day'?'Week view':'Day view',function(){calendarMode=calendarMode==='day'?'week':'day';calendar();}));
  box.appendChild(el('p','Business timezone: '+timezone,'muted'));var list=el('div');list.id='scheduleList';box.appendChild(list);list.textContent='Loading appointments…';
  try{var end=new Date(Date.parse(selectedDate+'T12:00Z')+(calendarMode==='day'?1:7)*86400000).toISOString().slice(0,10),data=await request('calendar?'+new URLSearchParams({from:utc(selectedDate+'T00:00'),to:utc(end+'T00:00')}));if(!list.isConnected)return;list.replaceChildren();
   var visits=data.appointments;if(!visits.length)list.appendChild(el('p','No visits scheduled. Open a request in your inbox to book one.','empty-state'));
   visits.forEach(function(a){var row=button('',function(){showTab('inbox');api.openCase(a.caseId);},'appointment-row');row.append(el('strong',pretty(a.startsAt)+' – '+new Intl.DateTimeFormat(undefined,{timeZone:timezone,hour:'numeric',minute:'2-digit'}).format(new Date(a.endsAt))),el('span',(a.appliance||'Appliance repair')+' · '+a.reference),el('span','ZIP '+(a.zip||'not provided')+' · '+(team.find(t=>t.id===a.technicianId)?.name||'Technician')));list.appendChild(row);});
  }catch(e){list.textContent=e.message;list.appendChild(button('Retry',calendar));}
 }
 async function deviceSettings(){
  var box=document.getElementById('deviceSettings');box.replaceChildren();var panel=el('section',undefined,'card');box.appendChild(panel);panel.appendChild(el('h3','This phone'));
  panel.appendChild(el('p','Unfinished notes are stored on this phone for up to 24 hours. Private briefs and photos are not downloaded for offline use.','muted'));
  panel.appendChild(button('Clear unsent drafts',async function(){await draftChain.catch(function(){});await remove((await records()).filter(r=>r.owner===account.id+':'+account.userId).map(r=>r.key));pendingActions.clear();notice('Unsent drafts cleared from this phone.');}));
  var status=el('p','Checking notifications…');status.id='notificationStatus';status.setAttribute('role','status');panel.appendChild(status);
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){status.textContent='Push notifications are not supported in this browser.';return;}
  try{var config=await request('push/config');if(!config.enabled){status.textContent='Phone notifications are not configured yet.';return;}
   var devices=await request('push/subscriptions');var current=devices.devices.find(d=>d.currentSession);
   status.textContent=Notification.permission==='denied'?'Notifications are blocked in browser settings.':current?'Notifications connected while you are signed in.':'Enable notifications for new requests and appointment reminders. Sign-in lasts eight hours.';
   var enable=button(current?'Reconnect notifications':'Enable notifications',async function(){try{
    var permission=await Notification.requestPermission();if(permission!=='granted'){status.textContent='Notifications are off. You can change this in browser settings.';return;}
    var reg=await navigator.serviceWorker.ready;var sub=await reg.pushManager.getSubscription();if(!sub){var raw=atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/'));sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(raw,c=>c.charCodeAt(0))});}
    await request('push/subscriptions',{method:'POST',headers:headers(),body:JSON.stringify(sub.toJSON())});deviceSettings();
   }catch(e){status.textContent=e.message;}});enable.id='enablePush';enable.disabled=Notification.permission==='denied';panel.appendChild(enable);
   if(current){panel.appendChild(button('Send test notification',async function(){try{await request('push/test',{method:'POST',headers:headers(),body:'{}'});status.textContent='Test queued. Check this phone for the notification.';}catch(e){status.textContent=e.message;}}));panel.appendChild(button('Turn off notifications',async function(){try{for(const d of devices.devices.filter(d=>d.currentSession))await request('push/subscriptions/'+d.id,{method:'DELETE',headers:headers()});var reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();if(sub)await sub.unsubscribe();deviceSettings();}catch(e){status.textContent=e.message;}}));}
  }catch(e){status.textContent=e.message;}
 }
 window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();installPrompt=e;});
 if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/staff/sw.js?v=__APP_VERSION__',{scope:'/staff/',updateViaCache:'none'}).then(function(reg){registration=reg;function ready(){if(reg.waiting&&navigator.serviceWorker.controller)noticeUpdate();}reg.addEventListener('updatefound',function(){reg.installing?.addEventListener('statechange',ready);});ready();}).catch(function(){notice('Use this app in your browser. Installation is unavailable right now.');});
  navigator.serviceWorker.addEventListener('controllerchange',function(){if(applyUpdate)location.reload();});
  navigator.serviceWorker.addEventListener('message',function(e){if(e.data?.type==='OPEN_CASE'&&/^[0-9a-f-]{36}$/i.test(e.data.caseId||'')){showTab('inbox');if(account)api.openCase(e.data.caseId);else location.hash='case='+e.data.caseId;}});
 }
 function noticeUpdate(){notice('An app update is ready. ');document.getElementById('appNotice').appendChild(button('Update app',async function(){await Promise.allSettled([...draftPromises]);applyUpdate=true;registration.waiting?.postMessage({type:'APPLY_UPDATE'});}));}
 var channel=typeof BroadcastChannel==='function'?new BroadcastChannel('mendcue-staff-account'):null;
 window.MendcueMobile={
  init:function(hooks){api=hooks;document.getElementById('tabCalendar').onclick=function(){api.pause();calendar();};document.getElementById('installApp').onclick=async function(){if(installPrompt){await installPrompt.prompt();installPrompt=null;}else notice(window.matchMedia('(display-mode: standalone)').matches?'MendCue is installed on this phone.':'On Android, open Chrome’s menu and choose “Add to home screen” or “Install app”.');};if(channel)channel.onmessage=function(e){if(e.data?.type==='logout')api.expire();};var slug=new URLSearchParams(location.search).get('business');try{document.getElementById('slug').value=slug||localStorage.getItem('mendcue-business')||'';}catch{if(slug)document.getElementById('slug').value=slug;}
   window.addEventListener('online',function(){notice('Connection available. Refresh to check for new requests.');});window.addEventListener('offline',function(){notice('Connection lost. Unsent edits stay on this phone; saving needs a connection.');});
  },
  enter:async function(identity){generation++;account=identity;timezone=identity.timezone||'America/Phoenix';try{localStorage.setItem('mendcue-business',identity.slug);}catch{}try{var data=await request('team');team=data.users;timezone=data.timezone;}catch(e){notice(e.message);}
   try{var owner=identity.id+':'+identity.userId;var drafts=(await records()).filter(r=>r.owner===owner&&r.createdAt+86400000>=Date.now()&&r.data.pending);await Promise.allSettled(drafts.map(async function(r){try{var caseId=r.key.split(':')[2];await request('cases/'+caseId+'/mutations/'+r.data.pending.clientMutationId);await remove([r.key]);}catch(e){if(e.status===404)pendingActions.set(r.key,r.data.pending);}}));}catch{}},
  detail:onDetail,
  settings:deviceSettings,
  refreshCalendar:calendar,
  hideDeviceSettings:function(){document.getElementById('deviceSettings').style.display='none';document.getElementById('calendar').style.display='none';},
  savedFields:async function(caseId,panel){if(!account)return;await draftChain.catch(function(){});var k=key(caseId,'review-fields'),record=await getDraft(k);if(!record)return;panel.querySelectorAll('[data-draft-field]').forEach(function(n){delete record.data.fields[n.dataset.draftField];});if(!Object.keys(record.data.fields).length)await remove([k]);else await write(record);},
  clearReviewDraft:function(caseId){if(account)remove([key(caseId,'review-fields')]).catch(function(){});},
  logout:async function(){var old=account;await draftChain.catch(function(){});generation++;account=null;pendingActions.clear();if(old)try{await remove((await records()).filter(r=>r.owner===old.id+':'+old.userId).map(r=>r.key));}catch{}try{var reg=await navigator.serviceWorker.getRegistration('/staff/');if(reg){var sub=await reg.pushManager.getSubscription();if(sub)await sub.unsubscribe();(await reg.getNotifications()).forEach(n=>n.close());}}catch{}channel?.postMessage({type:'logout'});},
  expired:function(){generation++;account=null;pendingActions.clear();document.getElementById('calendar').replaceChildren();document.getElementById('deviceSettings').replaceChildren();}
 };
})();
