import type { Store } from '../db/store.js';
export interface Appointment {
 tenantId:string; caseId:string; startsAt:string; endsAt:string; technicianId:string;
 timezone:string; active:boolean; note:string; reminderMinutes:number|null; updatedAt:string;
}
export class AppointmentOverlap extends Error { constructor(){super('This technician already has a visit during that time.');} }
export function overlaps(a:Appointment,b:Appointment):boolean {
 return a.active&&b.active&&a.caseId!==b.caseId&&a.tenantId===b.tenantId&&a.technicianId===b.technicianId&&a.startsAt<b.endsAt&&a.endsAt>b.startsAt;
}
export async function calendarRows(store:Store,tenantId:string,from:string,to:string) {
 const appointments=(await store.listAppointments(tenantId)).filter(a=>a.active&&a.startsAt<to&&a.endsAt>from);
 return Promise.all(appointments.map(async a=>{
  const c=await store.getCase(tenantId,a.caseId);const facts=await store.listFacts(tenantId,a.caseId);
  const byKey=new Map(facts.filter(f=>f.status!=='superseded').map(f=>[f.key,f.value]));
  return {...a,reference:c?.reference,workflowStatus:c?.workflowStatus,appliance:byKey.get('appliance_category')??null,zip:byKey.get('service_zip')??null};
 }));
}
