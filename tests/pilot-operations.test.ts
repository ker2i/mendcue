import { describe,it,expect,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { testApp } from "./helpers.js";
import { provision } from "../src/operator/provision.js";
import { verifyPassword } from "../src/server/auth.js";
import { createCase } from "../src/domain/intake.js";
import { FixtureProvider } from "../src/integrations/meta/fixture.js";
import { FilesystemStorage } from "../src/integrations/storage/storage.js";
import { processOneJob } from "../src/worker/worker.js";
import { reviewTimer } from "../src/domain/review-timer.js";

it("provisions private staff without demo credentials, with tenant-isolated login",async()=>{
 const {app,store}=await testApp();const template=(await store.listTenants())[0];
 const tenant={...template,id:"tnt_test_pilot",slug:"test-pilot",publicKey:"pk_"+randomUUID(),demoLabel:"",name:"Synthetic provisioning test"};
 await provision(store,tenant,"operator@example.invalid","Pilot operator","a unique test password 123!");
 const user=await store.getStaffByEmail(tenant.id,"operator@example.invalid");
 expect(await verifyPassword("a unique test password 123!",user!.passwordHash)).toBe(true);
 expect(user!.passwordHash).not.toContain("a unique test password");
 const login=await request(app).post("/api/v1/staff/login").send({tenantSlug:tenant.slug,email:user!.email,password:"a unique test password 123!"});
 expect(login.status).toBe(200);
 await expect(provision(store,tenant,user!.email,"Other","a unique test password 123!")).rejects.toThrow("exists");
});

it("retains other tenants and active cases, deleting expired relational/media data through a recoverable job",async()=>{
 const {store}=await testApp();const [tenant,other]=await store.listTenants();const provider=new FixtureProvider();
 const storage=new FilesystemStorage(mkdtempSync(join(tmpdir(),"retention-test-")));
 const deps={store,provider,storageGet:(key:string)=>storage.get(key)};
 const old=await createCase(deps,tenant,"widget"),active=await createCase(deps,tenant,"widget"),foreign=await createCase(deps,other,"widget");
 old.updatedAt="2020-01-01T00:00:00.000Z";foreign.updatedAt=old.updatedAt;await store.updateCase(old);await store.updateCase(foreign);
 const saved=await storage.put(old.id,"private.webp",Buffer.from("private"));
 await store.addAttachment({id:randomUUID(),tenantId:tenant.id,caseId:old.id,kind:"other",mimeType:"image/webp",...saved,rawOcrText:null,createdAt:old.updatedAt});
 expect(await store.purgeExpired(tenant,new Date().toISOString())).toBe(1);
 expect(await store.getCase(tenant.id,old.id)).toBeNull();expect(await store.getCase(tenant.id,active.id)).not.toBeNull();expect(await store.getCase(other.id,foreign.id)).not.toBeNull();
 expect(await store.listAttachments(tenant.id,old.id)).toHaveLength(0);
 await processOneJob({store,provider,storage});expect(await storage.get(saved.storageKey)).toBeNull();
 expect((await store.listJobs(tenant.id)).find(j=>j.kind==="storage_delete")?.payload).toEqual({});
});

it("fences completion from an expired lease",async()=>{
 const {store}=await testApp();const tenant=(await store.listTenants())[0];const now="2026-10-30T00:00:00.000Z";const id=randomUUID();
 await store.enqueueJob({id,tenantId:tenant.id,caseId:null,kind:"test",payload:{},status:"pending",attempts:0,maxAttempts:3,leaseUntil:null,lastError:null,createdAt:now,updatedAt:now});
 const first=await store.leaseJob(now);const second=await store.leaseJob("2026-10-30T00:03:00.000Z");
 await store.completeJob(id,first!.attempts);expect((await store.listJobs(tenant.id))[0].status).toBe("leased");
 await store.completeJob(id,second!.attempts);expect((await store.listJobs(tenant.id))[0].status).toBe("done");
});

it("keeps active review intervals separate from elapsed case age and other actors",()=>{
 const event=(actor:string,action:string,time:string)=>({id:randomUUID(),tenantId:"t",caseId:"c",type:"review_timer",payload:{recordedBy:actor,action},createdAt:time});
 const events=[event("a","start","2026-10-30T00:00:00Z"),event("b","start","2026-10-30T00:00:02Z"),event("a","pause","2026-10-30T00:00:10Z"),event("a","start","2026-10-30T05:00:00Z"),event("a","pause","2026-10-30T05:00:05Z")];
 expect(reviewTimer(events,"a")).toEqual({activeSeconds:15,startedAt:null});expect(reviewTimer(events,"b").activeSeconds).toBe(0);
});

it("persists identity verification and measured timer events without mutating submitted snapshots",async()=>{
 const {app,store}=await testApp();const tenant=(await store.getTenantBySlug("demo-phoenix-appliance"))!;
 const provider=new FixtureProvider();const c=await createCase({store,provider,storageGet:async()=>null},tenant,"widget");c.conversationPhase="review";await store.updateCase(c);
 const {submitCase}=await import("../src/domain/intake.js");await submitCase({store,provider,storageGet:async()=>null},tenant,c.id,{acknowledgeIncomplete:true});
 const snapshots=await store.listHandoffs(tenant.id,c.id);
 const login=await request(app).post("/api/v1/staff/login").send({tenantSlug:tenant.slug,email:"tech@demo-phoenix.invalid",password:"demo-tech-1234"});
 const cookies=(login.headers["set-cookie"] as unknown as string[]).map(x=>x.split(";")[0]).join("; ");
 const post=async(path:string,body:Record<string,unknown>)=>request(app).post(`/api/v1/staff/cases/${c.id}/${path}`).set("cookie",cookies).set("x-csrf-token",login.body.csrf).send({version:(await store.getCase(tenant.id,c.id))!.version,...body});
 const verification=await post("identity-verification",{brand:"LG",model:"WM3900HBA",serial:null,provenance:"physical_label",note:"Read the physical rating label"});
 expect(verification.status).toBe(201);expect(verification.body.version).toBe((await store.getCase(tenant.id,c.id))!.version);
 const staleTimer=await request(app).post(`/api/v1/staff/cases/${c.id}/review-timer`).set("cookie",cookies).set("x-csrf-token",login.body.csrf).send({version:verification.body.version-1,action:"start"});
 expect(staleTimer.status).toBe(409);expect((await store.listEvents(tenant.id,c.id)).filter(e=>e.type==="review_timer")).toHaveLength(0);
 expect((await post("review-timer",{action:"start"})).status).toBe(201);
 expect((await post("review-timer",{action:"start"})).status).toBe(409);
 expect((await post("review-timer",{action:"pause"})).status).toBe(201);
 const review=await post("review",{disposition:"need_information",missingFacts:["Timeline"],unsupportedAssertions:[],reviewSeconds:999,timingMethod:"measured"});
 expect(review.status).toBe(201);expect(review.body.review.payload.reviewSeconds).toBeLessThan(999);
 expect(await store.listHandoffs(tenant.id,c.id)).toEqual(snapshots);
 const detail=await request(app).get(`/api/v1/staff/cases/${c.id}`).set("cookie",cookies);
 expect(detail.body.reviewTimer.startedAt).toBeNull();expect(detail.body.events.some((e:{type:string})=>e.type==="technician_identity_verified")).toBe(true);
});

it("expires only recognized exports in the selected tenant directory, preserving the ledger and other tenants",async()=>{
 const {mkdirSync,writeFileSync,utimesSync,existsSync}=await import("node:fs");const {pruneArtifacts}=await import("../src/operator/artifact-retention.js");
 const root=mkdtempSync(join(tmpdir(),"artifact-retention-"));for(const id of ["tenant-a","tenant-b"])mkdirSync(join(root,id));
 const stale=new Date("2020-01-01");
 for(const path of [join(root,"tenant-a","run.private.json"),join(root,"tenant-a","meta-usage.json"),join(root,"tenant-b","run.private.json")]){writeFileSync(path,"{}");utimesSync(path,stale,stale);}
 await pruneArtifacts(root,"tenant-a",14);
 expect(existsSync(join(root,"tenant-a","run.private.json"))).toBe(false);expect(existsSync(join(root,"tenant-a","meta-usage.json"))).toBe(true);expect(existsSync(join(root,"tenant-b","run.private.json"))).toBe(true);
});
