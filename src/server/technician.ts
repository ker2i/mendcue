import express from 'express';
import { randomUUID,createHash } from 'node:crypto';
import {z} from 'zod';
import type {AppDeps} from './app.js';
import type {TenantConfig,CaseEvent,CaseRecord} from '../domain/types.js';
import type {StaffUser,StaffSession,JobRecord} from '../db/store.js';
import {AppointmentOverlap,calendarRows,type Appointment} from '../domain/appointments.js';
import {eligibleRegistrations,pushConfig,validateSubscription} from '../integrations/push.js';
import {errorBody} from '../domain/types.js';
import {requestId,rateLimit} from './auth.js';
const context=(req:express.Request)=>req as unknown as {staffTenant:TenantConfig;staffUser:StaffUser;staffSession:StaffSession};
export function localToUtc(value:string,timezone:string){
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))throw Error('Choose a valid date and time.');
 const target=Date.parse(value+'Z');if(!Number.isFinite(target))throw Error('Invalid time.');
 const format=(time:number)=>{
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(time);
  const get=(key:string)=>p.find(x=>x.type===key)!.value;return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
 };
 let time=target;for(let i=0;i<3;i++)time+=target-Date.parse(format(time)+'Z');
 if(format(time)!==value)throw Error('That local time does not exist. Choose another time.');
 if(format(time-3600000)===value||format(time+3600000)===value)throw Error('That local time occurs twice. Choose an unambiguous time.');
 return new Date(time).toISOString();
}
const base={version:z.number().int().positive(),clientMutationId:z.string().uuid()};
const actionSchema=z.discriminatedUnion('kind',[
 z.object({...base,kind:z.literal('appointment'),startsLocal:z.string().max(16),endsLocal:z.string().max(16),technicianId:z.string().uuid().optional(),note:z.string().max(2000).default(''),reminderMinutes:z.union([z.literal(15),z.literal(30),z.literal(60),z.null()]).default(30)}),
 z.object({...base,kind:z.literal('unschedule')}),
 z.object({...base,kind:z.literal('note'),note:z.string().trim().min(1).max(2000)}),
 z.object({...base,kind:z.literal('workflow'),status:z.enum(['new','reviewing','contacted','scheduled','closed','cancelled'])})
]);
export function registerTechnicianRoutes(app:express.Express,deps:AppDeps,auth:express.RequestHandler,mutate:express.RequestHandler){
 const fail=(res:express.Response,status:number,code:string,message:string)=>res.status(status).json(errorBody(code,message,requestId()));
 app.get('/api/v1/staff/calendar',auth,async(req,res)=>{
  const {staffTenant:t}=context(req);const parsed=z.object({from:z.string().datetime(),to:z.string().datetime()}).safeParse(req.query);
  if(!parsed.success||Date.parse(parsed.data.to)<=Date.parse(parsed.data.from)||Date.parse(parsed.data.to)-Date.parse(parsed.data.from)>32*86400000)return fail(res,400,'VALIDATION_ERROR','Choose a calendar range of up to 32 days.');
  res.json({timezone:t.timezone,appointments:await calendarRows(deps.store,t.id,parsed.data.from,parsed.data.to)});
 });
 app.get('/api/v1/staff/team',auth,async(req,res)=>{
  const {staffTenant:t,staffUser:u}=context(req);
  // All existing staff are operator provisioned; expose only assignable names/IDs.
  const users=await deps.store.listStaffUsers(t.id);
  res.json({users:users.filter(x=>x.role!=='readonly').map(x=>({id:x.id,name:x.name})),timezone:t.timezone,userId:u.id});
 });
 app.get('/api/v1/staff/cases/:caseId/mutations/:mutationId',auth,async(req,res)=>{
  const {staffTenant:t,staffUser:u}=context(req);if(!z.string().uuid().safeParse(req.params.mutationId).success)return fail(res,404,'NOT_FOUND','No saved action found.');
  const e=await deps.store.findMutationReceipt(t.id,u.id,req.params.mutationId);
  if(!e||e.caseId!==req.params.caseId)return fail(res,404,'NOT_FOUND','No saved action found.');res.json(e.payload.result);
 });
 app.post('/api/v1/staff/cases/:caseId/action',auth,mutate,async(req,res)=>{
  const {staffTenant:t,staffUser:u}=context(req);const parsed=actionSchema.safeParse(req.body);
  if(!parsed.success)return fail(res,400,'VALIDATION_ERROR','Check the appointment or note fields.');
  const data=parsed.data;const hash=createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const replay=async()=>{
   const e=await deps.store.findMutationReceipt(t.id,u.id,data.clientMutationId);
   if(e){if(e.caseId!==req.params.caseId||e.payload.hash!==hash)fail(res,409,'MUTATION_ID_CONFLICT','This action ID was already used for different details.');else res.json(e.payload.result);return true;}
   return false;
  };
  if(await replay())return;
  const c=await deps.store.getCase(t.id,req.params.caseId);
  if(!c)return fail(res,404,'NOT_FOUND','Request not found.');
  if(c.version!==data.version)return fail(res,409,'CASE_VERSION_CONFLICT','This request changed. Refresh the request and review your unsent changes.');
  if(!c.submittedAt)return fail(res,409,'NOT_SUBMITTED','The customer has not submitted this request yet.');
  const now=new Date().toISOString();const old=(await deps.store.listAppointments(t.id)).find(a=>a.caseId===c.id);
  let appointment:Appointment|undefined;const jobs:JobRecord[]=[];
  if(data.kind==='appointment'){
   if(['closed','cancelled'].includes(c.workflowStatus))return fail(res,409,'CASE_CLOSED','Reopen this request before booking a visit.');
   let startsAt:string,endsAt:string;
   try{startsAt=localToUtc(data.startsLocal,t.timezone);endsAt=localToUtc(data.endsLocal,t.timezone);}catch(e){return fail(res,400,'VALIDATION_ERROR',(e as Error).message);}
   const duration=Date.parse(endsAt)-Date.parse(startsAt);
   if(duration<15*60000||duration>12*3600000||Date.parse(startsAt)<Date.now()-60000||Date.parse(startsAt)>Date.now()+366*86400000)return fail(res,400,'VALIDATION_ERROR','Book a future visit lasting 15 minutes to 12 hours, within the next year.');
   const assignee=await deps.store.getStaffById(t.id,data.technicianId??u.id);
   if(!assignee||assignee.role==='readonly')return fail(res,400,'VALIDATION_ERROR','Choose a technician from this business.');
   appointment={tenantId:t.id,caseId:c.id,startsAt,endsAt,technicianId:assignee.id,timezone:t.timezone,active:true,note:data.note,reminderMinutes:data.reminderMinutes,updatedAt:now};
   c.workflowStatus='scheduled';
   if(pushConfig().enabled&&data.reminderMinutes){const targets=(await eligibleRegistrations(deps.store,t.id)).filter(r=>r.userId===assignee.id).map(r=>r.id);
    {const due=new Date(Math.max(Date.now(),Date.parse(startsAt)-data.reminderMinutes*60000)).toISOString();jobs.push({id:randomUUID(),tenantId:t.id,caseId:c.id,kind:'staff_reminder',payload:{type:'appointment_reminder',technicianId:assignee.id,appointmentVersion:now,delivered:[],expiresAt:startsAt},availableAt:due,status:'pending',attempts:0,maxAttempts:5,leaseUntil:null,lastError:null,createdAt:now,updatedAt:now});}}
  }else if(data.kind==='unschedule'){
   if(!old?.active)return fail(res,409,'NOT_SCHEDULED','There is no active appointment to cancel.');
   appointment={...old,active:false,updatedAt:now};if(c.workflowStatus==='scheduled')c.workflowStatus='contacted';
  }else if(data.kind==='workflow'){
   if(data.status==='scheduled'&&!old?.active)return fail(res,400,'APPOINTMENT_REQUIRED','Book an appointment to mark this request scheduled.');
   c.workflowStatus=data.status;
   if(old?.active&&['closed','cancelled'].includes(data.status))appointment={...old,active:false,updatedAt:now};
  }
  c.version++;c.updatedAt=now;
  const result={ok:true,version:c.version,workflowStatus:c.workflowStatus,appointment:appointment??old??null};
  const event:CaseEvent={id:randomUUID(),tenantId:t.id,caseId:c.id,type:data.kind==='note'?'staff_note':data.kind==='workflow'?'staff_update':'appointment_updated',payload:{...data,recordedBy:u.id,appointment:appointment??null},createdAt:now};
  const receipt:CaseEvent={id:randomUUID(),tenantId:t.id,caseId:c.id,type:'staff_mutation_receipt',payload:{clientMutationId:data.clientMutationId,recordedBy:u.id,hash,result},createdAt:now};
  try{
   const ok=await deps.store.commitCase({record:c,expectedVersion:data.version,events:[event,receipt],jobs,appointment});
   if(!ok){if(await replay())return;return fail(res,409,'CASE_VERSION_CONFLICT','This request changed. Refresh before saving.');}
   res.json(result);
  }catch(e){if((e as {code?:string}).code==='23505'&&await replay())return;if(e instanceof AppointmentOverlap)return fail(res,409,'APPOINTMENT_OVERLAP',e.message);throw e;}
 });
 app.get('/api/v1/staff/push/config',auth,(_req,res)=>res.json(pushConfig()));
 app.get('/api/v1/staff/push/subscriptions',auth,async(req,res)=>{
  const {staffTenant:t,staffUser:u,staffSession:s}=context(req);
  const active=(await eligibleRegistrations(deps.store,t.id)).filter(r=>r.userId===u.id);
  res.json({devices:active.map(r=>({id:r.id,createdAt:r.createdAt,currentSession:r.sessionId===s.id}))});
 });
 app.post('/api/v1/staff/push/subscriptions',auth,async(req,res)=>{
  if(!pushConfig().enabled)return fail(res,503,'PUSH_DISABLED','Notifications are not configured.');
  const {staffTenant:t,staffUser:u,staffSession:s}=context(req);
  const data=z.object({endpoint:z.string().max(4096),keys:z.object({p256dh:z.string().max(100),auth:z.string().max(32)})}).safeParse(req.body);
  if(!data.success)return fail(res,400,'VALIDATION_ERROR','Invalid device subscription.');
  let hash:string;try{hash=validateSubscription(data.data);}catch{return fail(res,400,'VALIDATION_ERROR','Unsupported or invalid push subscription.');}
  const old=(await eligibleRegistrations(deps.store,t.id)).find(r=>r.userId===u.id&&r.endpointHash===hash);
  const now=new Date().toISOString();const registration={...data.data,id:old?.id??randomUUID(),tenantId:t.id,userId:u.id,sessionId:s.id,endpointHash:hash,enabled:true,createdAt:old?.createdAt??now,updatedAt:now};
  if(!await deps.store.savePushRegistration(registration))return fail(res,409,'DEVICE_CONFLICT','This device is already registered or the five-device limit was reached.');
  res.status(201).json({id:registration.id});
 });
 app.delete('/api/v1/staff/push/subscriptions/:id',auth,async(req,res)=>{
  const {staffTenant:t,staffUser:u}=context(req);if(z.string().uuid().safeParse(req.params.id).success)await deps.store.disablePushRegistration(t.id,u.id,req.params.id);res.json({ok:true});
 });
 app.post('/api/v1/staff/push/test',auth,async(req,res)=>{
  const {staffTenant:t,staffUser:u,staffSession:s}=context(req);
  if(!pushConfig().enabled)return fail(res,503,'PUSH_DISABLED','Notifications are not configured.');
  if(!rateLimit('push-test:'+t.id+':'+u.id,3,3600000))return fail(res,429,'RATE_LIMITED','Try another test later.');
  const targets=(await eligibleRegistrations(deps.store,t.id)).filter(r=>r.userId===u.id&&r.sessionId===s.id).map(r=>r.id);
  if(!targets.length)return fail(res,409,'NOT_SUBSCRIBED','Enable notifications on this device first.');
  const now=new Date().toISOString();await deps.store.enqueueJob({id:randomUUID(),tenantId:t.id,caseId:null,kind:'staff_push',payload:{type:'test',targets,delivered:[],expiresAt:new Date(Date.now()+3600000).toISOString()},status:'pending',attempts:0,maxAttempts:5,leaseUntil:null,lastError:null,createdAt:now,updatedAt:now});res.status(202).json({queued:true});
 });
}
