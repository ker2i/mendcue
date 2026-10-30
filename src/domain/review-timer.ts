import type { CaseEvent } from "./types.js";
// Explicit staff-designated active intervals; never derive effort from case age.
export function reviewTimer(events: CaseEvent[], actor: string) {
  let activeSeconds=0;let startedAt:string|null=null;
  for(const e of events){
    if(e.type!=="review_timer"||e.payload.recordedBy!==actor)continue;
    if(e.payload.action==="start" && !startedAt)startedAt=e.createdAt;
    if(e.payload.action==="pause" && startedAt){
      activeSeconds+=Math.max(0,(Date.parse(e.createdAt)-Date.parse(startedAt))/1000);startedAt=null;
    }
  }
  return {activeSeconds:Math.round(activeSeconds),startedAt};
}
