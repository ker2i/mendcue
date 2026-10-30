import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryStore } from "../src/db/memory.js";
import { seedStore } from "../src/db/seed.js";
import { createCase, submitCase } from "../src/domain/intake.js";
import { FixtureProvider } from "../src/integrations/meta/fixture.js";
import { processOneJob } from "../src/worker/worker.js";
import type { JobRecord } from "../src/db/store.js";

const job = (tenantId: string, caseId: string | null, time: string): JobRecord => ({ id: randomUUID(), tenantId, caseId, kind: "webhook", payload: {eventType:"case.submitted"}, status:"pending", attempts:0,maxAttempts:3,leaseUntil:null,lastError:null,createdAt:time,updatedAt:time });

export async function preparedCase(store = new MemoryStore()) {
  await seedStore(store);
  const tenant = (await store.listTenants())[0];
  const deps = { store, provider:new FixtureProvider(),storageGet:async()=>null };
  const c = await createCase(deps,tenant,"widget");
  c.conversationPhase="review"; await store.updateCase(c);
  return { store, tenant, deps, c };
}

describe("durable submission/outbox", () => {
  it("commits one logical submission under concurrent and repeated requests", async () => {
    const {store,tenant,deps,c}=await preparedCase();
    const results=await Promise.all(Array.from({length:4},()=>submitCase(deps,tenant,c.id,{acknowledgeIncomplete:true})));
    expect(results.map(r=>r.handoffVersion)).toEqual([1,1,1,1]);
    expect(await store.listHandoffs(tenant.id,c.id)).toHaveLength(1);
    expect((await store.listEvents(tenant.id,c.id)).filter(e=>e.type==="case_submitted")).toHaveLength(1);
    expect(await store.listJobs(tenant.id)).toHaveLength(1);
  });
  it("does not expose any partial submission when atomic commit fails",async()=>{
    const {store,tenant,deps,c}=await preparedCase();
    vi.spyOn(store,"commitCase").mockRejectedValue(new Error("injected failure"));
    await expect(submitCase(deps,tenant,c.id,{acknowledgeIncomplete:true})).rejects.toThrow("injected");
    expect(await store.listHandoffs(tenant.id,c.id)).toHaveLength(0);
    expect(await store.getAssessment(tenant.id,c.id)).toBeNull();
    expect((await store.getCase(tenant.id,c.id))?.submittedAt).toBeNull();
    expect(await store.listJobs(tenant.id)).toHaveLength(0);
  });
  it("honors persisted availability, expiry, attempt limits, ordering and bounded tenant retries",async()=>{
    const {store,tenant,c}=await preparedCase();
    const now="2026-10-30T00:00:00.000Z", due="2026-10-30T00:01:00.000Z";
    const first=job(tenant.id,c.id,now); first.availableAt=due;
    const second=job(tenant.id,c.id,"2026-10-30T00:00:01.000Z");
    await store.enqueueJob(first);await store.enqueueJob(second);
    expect(await store.leaseJob(now)).toBeNull();
    expect((await store.leaseJob(due))?.id).toBe(first.id);
    expect(await store.leaseJob(due)).toBeNull();
    await store.failJob(first.id,"temporary","2026-10-30T00:02:00.000Z");
    expect(await store.leaseJob(due)).toBeNull();
    expect((await store.leaseJob("2026-10-30T00:02:00.000Z"))?.attempts).toBe(2);
    expect((await store.leaseJob("2026-10-30T00:04:01.000Z"))?.attempts).toBe(3);
    expect(await store.leaseJob("2026-10-30T00:06:02.000Z")).toBeNull();
    expect(store.jobs[0].status).toBe("failed");
    expect(await store.retryJob("another-tenant",first.id)).toBe(false);
    for(let i=0;i<3;i++) { expect(await store.retryJob(tenant.id,first.id)).toBe(true);await store.failJob(first.id,"stop",null); }
    expect(await store.retryJob(tenant.id,first.id)).toBe(false);
  });
  it("keeps event bytes across a worker restart and skips already successful endpoints",async()=>{
    const {store,tenant,c}=await preparedCase();
    for(const name of ["good","flaky"]) await store.saveEndpoint({id:name,tenantId:tenant.id,url:`https://${name}.example/hook`,secret:"test",events:[],active:true});
    const j=job(tenant.id,c.id,new Date().toISOString());await store.enqueueJob(j);
    const bodies:string[]=[];let flakyAttempts=0;
    const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async (url,opts)=>{
      bodies.push(String(opts?.body));
      return new Response("",{status:String(url).includes("flaky") && ++flakyAttempts===1?503:200});
    });
    const deps={store,provider:new FixtureProvider(),storage:{put:async()=>{throw 0;},get:async()=>null}};
    try {
      await processOneJob(deps);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(await processOneJob(deps)).toBe(false);
      // Simulate time passing, keeping persisted queue/event/delivery data.
      store.jobs[0].availableAt=new Date(0).toISOString();
      // JSONB can reorder object keys; persisted signed bytes must remain stable.
      const event=store.jobs[0].payload.event as Record<string,unknown>;
      store.jobs[0].payload.event=Object.fromEntries(Object.entries(event).reverse());
      await processOneJob({...deps});
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(new Set(bodies).size).toBe(1);
      expect((await store.listJobs(tenant.id))[0].status).toBe("done");
      expect((await store.listDeliveries(tenant.id)).map(d=>d.attempts).sort()).toEqual([1,2]);
    } finally { fetchMock.mockRestore(); }
  });
});
