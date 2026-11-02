import webpush from 'web-push';
import { Agent } from 'node:https';
import { lookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { createECDH, createHash, randomUUID } from 'node:crypto';
import type { Store, PushRegistration, JobRecord } from '../db/store.js';
const HOSTS=new Set(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']);
const blocked=new BlockList();
for(const [net,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['192.0.0.0',24],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]] as const)blocked.addSubnet(net,bits,'ipv4');
export function publicAddress(ip:string){return isIP(ip)===4?!blocked.check(ip,'ipv4'):isIP(ip)===6&&/^[23][0-9a-f]{3}:/i.test(ip);}
const agent=new Agent({lookup:(host,options,callback)=>{
 if(!HOSTS.has(host))return callback(new Error('Push host rejected'),' ',4);
 lookup(host,{all:true},(error,addresses)=>{
  if(error||!addresses.length||addresses.some(a=>!publicAddress(a.address)))return callback(new Error('Push address rejected'),' ',4);
  // Pin the validated resolution to the actual outgoing socket; no second DNS lookup.
  if(typeof options==='object'&&options.all)(callback as unknown as (e:null,a:typeof addresses)=>void)(null,addresses);
  else callback(null,addresses[0].address,addresses[0].family);
 });
}});
export function pushConfig(env:NodeJS.ProcessEnv=process.env){
 const enabled=env.PUSH_ENABLED==='1';
 if(enabled){try{
  const pub=Buffer.from(env.VAPID_PUBLIC_KEY??'','base64url'),priv=Buffer.from(env.VAPID_PRIVATE_KEY??'','base64url');
  const ecdh=createECDH('prime256v1');ecdh.setPrivateKey(priv);
  if(pub.length!==65||!ecdh.getPublicKey().equals(pub)||!/^mailto:[^\s@]+@[^\s@]+$/.test(env.VAPID_SUBJECT??''))throw Error();
 }catch{throw Error('Enabled push requires a valid matching VAPID key pair and mailto subject');}}
 return {enabled,publicKey:enabled?env.VAPID_PUBLIC_KEY!:null};
}
export function validateSubscription(value:{endpoint:string;keys:{p256dh:string;auth:string}}){
 const u=new URL(value.endpoint);
 if(u.protocol!=='https:'||u.username||u.password||u.hash||(u.port&&u.port!=='443')||!HOSTS.has(u.hostname)||value.endpoint.length>4096)throw Error('Unsupported push service');
 const key=Buffer.from(value.keys.p256dh,'base64url'),auth=Buffer.from(value.keys.auth,'base64url');
 if(key.length!==65||key[0]!==4||auth.length!==16)throw Error('Invalid subscription keys');
 // Validate the point, not only its encoded length.
 const e=createECDH('prime256v1');e.generateKeys();e.computeSecret(key);
 return createHash('sha256').update(value.endpoint).digest('hex');
}
export type PushSender=(registration:PushRegistration,payload:Record<string,unknown>,ttl:number)=>Promise<void>;
export const sendPush:PushSender=async(registration,payload,ttl)=>{
 if(!pushConfig().enabled)throw Error('Push disabled');
 validateSubscription(registration);
 await webpush.sendNotification({endpoint:registration.endpoint,keys:registration.keys},JSON.stringify(payload),{
  TTL:Math.max(0,Math.min(3600,ttl)),timeout:5000,agent,
  vapidDetails:{subject:process.env.VAPID_SUBJECT!,publicKey:process.env.VAPID_PUBLIC_KEY!,privateKey:process.env.VAPID_PRIVATE_KEY!}
 });
};
export async function eligibleRegistrations(store:Store,tenantId:string){
 const result:PushRegistration[]=[];
 for(const r of await store.listPushRegistrations(tenantId)){
  const s=await store.getStaffSession(r.sessionId);const u=await store.getStaffById(tenantId,r.userId);
  if(s&&s.tenantId===tenantId&&s.userId===r.userId&&s.expiresAt>new Date().toISOString()&&u)result.push(r);
  else await store.disablePushRegistration(tenantId,r.userId,r.id);
 }
 return result;
}
export async function newBriefPushJob(store:Store,tenantId:string,caseId:string):Promise<JobRecord[]> {
 if(!pushConfig().enabled)return [];
 const now=new Date().toISOString();const targets=(await eligibleRegistrations(store,tenantId)).map(r=>r.id).slice(0,100);
 const jobs:JobRecord[]=[];const eventId=randomUUID();
 for(let i=0;i<targets.length;i+=10)jobs.push({id:randomUUID(),tenantId,caseId,kind:'staff_push',payload:{type:'new_brief',eventId,targets:targets.slice(i,i+10),delivered:[],expiresAt:new Date(Date.now()+3600000).toISOString()},status:'pending',attempts:0,maxAttempts:8,leaseUntil:null,lastError:null,createdAt:now,updatedAt:now,availableAt:now});
 return jobs;
}
export async function deliverPush(store:Store,job:JobRecord,sender:PushSender=sendPush){
 const payload=job.payload;if(Date.parse(String(payload.expiresAt))<=Date.now())return;
 if(job.caseId){const c=await store.getCase(job.tenantId,job.caseId);if(!c||['closed','cancelled'].includes(c.workflowStatus))return;
  if(payload.type==='appointment_reminder'){
   const a=(await store.listAppointments(job.tenantId)).find(a=>a.caseId===job.caseId);
   if(!a?.active||a.updatedAt!==payload.appointmentVersion)return;
  }
 }
 const registrations=await eligibleRegistrations(store,job.tenantId);
 if(payload.type==='appointment_reminder'&&!payload.targets){payload.targets=registrations.filter(r=>r.userId===payload.technicianId).map(r=>r.id);await store.updateJobPayload(job.tenantId,job.id,payload);}
 const done=new Set((payload.delivered??[]) as string[]);let failed=false;
 for(const id of (payload.targets??[]) as string[]){
  if(done.has(id))continue;const r=registrations.find(r=>r.id===id);
  if(!r){done.add(id);continue;}
  try{await sender(r,{type:payload.type,eventId:payload.eventId??job.id,caseId:job.caseId,expiresAt:payload.expiresAt},Math.ceil((Date.parse(String(payload.expiresAt))-Date.now())/1000));done.add(id);}
  catch(e){const code=(e as {statusCode?:number}).statusCode;if(code===404||code===410){await store.disablePushRegistration(job.tenantId,r.userId,r.id);done.add(id);}else failed=true;}
  payload.delivered=[...done];await store.updateJobPayload(job.tenantId,job.id,payload);
 }
 if(failed)throw Error('Some push deliveries pending');
}
