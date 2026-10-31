// Real-PostgreSQL integration run (PGlite = genuine Postgres engine, in-process).
// Exercises: migrations, seeding, restricted app_runtime role, RLS isolation,
// composite FKs, bootstrap paths, jobs, and a full text intake on PgStore.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { PgStore, type PgPoolLike } from "../src/db/pg.js";
import { applyMigrations } from "../src/db/migrate.js";
import { seedStore } from "../src/db/seed.js";
import { createCase, processTurn, submitCase } from "../src/domain/intake.js";
import { FixtureProvider } from "../src/integrations/meta/fixture.js";
import { sha256 } from "../src/server/auth.js";

let db: PGlite;
let store: PgStore;
let runtimePool: Pool | undefined;

function adapter(pg: PGlite): PgPoolLike {
  if (runtimePool) return runtimePool;
  const query = async (text: string, params: unknown[] = []) => {
    const r = await pg.query(text, params as never[]);
    return { rows: r.rows as Record<string, unknown>[] };
  };
  return {
    query,
    connect: async () => ({ query, release: () => {} }),
  };
}

beforeAll(async () => {
  if (process.env.TEST_POSTGRES_URL) {
    const url = new URL(process.env.TEST_POSTGRES_URL);
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.startsWith("/mendcue_test")) throw new Error("Container tests require a dedicated local mendcue_test database");
    const owner = new Pool({connectionString:url.href});
    try {
      const client=await owner.connect();
      try { await applyMigrations((sql,params)=>client.query(sql,params),(sql)=>client.query(sql)); }
      finally { client.release(); }
    }
    finally { await owner.end(); }
    url.username="app_runtime";url.password="change_me_in_production";
    runtimePool = new Pool({connectionString:url.href});
    db = { query:(sql:string,params?:unknown[])=>runtimePool!.query(sql,params), exec:(sql:string)=>runtimePool!.query(sql), close:()=>runtimePool!.end() } as unknown as PGlite;
    store = new PgStore(runtimePool);
    await seedStore(store);
    return;
  }
  db = new PGlite();
  await db.waitReady;
  const applied = await applyMigrations(
    (sql, params) => adapter(db).query(sql, params),
    (sql) => db.exec(sql)
  );
  expect(applied).toContain("001_init.sql");
  expect(applied).toContain("002_rls.sql");
  expect(applied).toContain("004_auth_paths.sql");
  expect(applied).toContain("005_composite_fk.sql");
  // Operate as the restricted runtime role from here on, like production.
  await db.exec("SET ROLE app_runtime");
  store = new PgStore(adapter(db));
  await seedStore(store);
}, 120000);

afterAll(async () => {
  await db?.close();
});

describe("postgres integration", () => {
  it("seeded two demo tenants with approved playbook knowledge", async () => {
    const tenants = await store.listTenants();
    expect(tenants.map((t) => t.slug).sort()).toEqual(["demo-harbor-warranty", "demo-phoenix-appliance"]);
    const docs = await store.listDocuments(tenants[0].id);
    expect(docs.length).toBe(3);
    const chunks = await store.listChunks(tenants[0].id);
    expect(chunks.length).toBe(5);
    // Chunks reference real documents (R10 binding defect stays fixed).
    for (const c of chunks) {
      expect(docs.some((d) => d.id === c.documentId)).toBe(true);
    }
  });

  it("completes a text intake to a persisted handoff on Postgres", async () => {
    const tenant = await store.getTenantBySlug("demo-phoenix-appliance");
    const deps = { store, provider: new FixtureProvider(), storageGet: async () => null as unknown as Buffer };
    const c = await createCase(deps, tenant!, "widget");
    for (const text of ["Washer fills then stops, LG, says OE.", "85003", "jane@example.com", "done"]) {
      const msgId = randomUUID();
      await store.addMessage({ id: msgId, tenantId: tenant!.id, caseId: c.id, role: "customer", body: text, createdAt: new Date().toISOString() });
      await processTurn(deps, tenant!, c.id, msgId, text);
    }
    const { handoffVersion } = await submitCase(deps, tenant!, c.id);
    expect(handoffVersion).toBe(1);
    const handoffs = await store.listHandoffs(tenant!.id, c.id);
    expect((handoffs[0].snapshot as { error_codes_verbatim: string[] }).error_codes_verbatim).toContain("OE");
  });

  it("persists usage basis and invalidates only the selected tenant draft assessment", async () => {
    const tenant = (await store.getTenantBySlug("demo-phoenix-appliance"))!;
    const document = { ...(await store.listDocuments(tenant.id))[0], id: "doc_private_upgrade", tenantId: tenant.id, visibility: "tenant_private" as const, usageBasis: "Locally supplied; operator permission recorded" };
    await store.saveDocument(document);
    expect((await store.listDocuments(tenant.id)).find(d=>d.id===document.id)?.usageBasis).toBe(document.usageBasis);
    expect((await store.listDocuments("tnt_demo_harbor")).some(d=>d.id===document.id)).toBe(false);
    const c=await createCase({store,provider:new FixtureProvider(),storageGet:async()=>null},tenant,"widget");
    await store.saveAssessment({id:randomUUID(),tenantId:tenant.id,caseId:c.id,status:"ok",hypotheses:[],recommendedFollowUp:"Review",knowledgeLevel:"unknown",citations:[],createdAt:new Date().toISOString()});
    await store.clearAssessment("tnt_demo_harbor",c.id);
    expect(await store.getAssessment(tenant.id,c.id)).not.toBeNull();
    await store.clearAssessment(tenant.id,c.id);
    expect(await store.getAssessment(tenant.id,c.id)).toBeNull();
  });

  it("denies cross-tenant reads at the app and RLS layers", async () => {
    const a = await store.getTenantBySlug("demo-phoenix-appliance");
    const b = await store.getTenantBySlug("demo-harbor-warranty");
    const deps = { store, provider: new FixtureProvider(), storageGet: async () => null as unknown as Buffer };
    const c = await createCase(deps, a!, "widget");
    expect(await store.getCase(b!.id, c.id)).toBeNull();
    expect((await store.listCases(b!.id)).some((x) => x.id === c.id)).toBe(false);
    // RLS layer: no tenant context → no rows, even though rows exist.
    const bare = await db.query("SELECT id FROM cases");
    expect(bare.rows.length).toBe(0);
    // Composite FK: a child row with a mismatched tenant is rejected even
    // when RLS context would otherwise permit the write.
    await db.query("BEGIN");
    await db.query("SELECT set_config('app.tenant_id', $1, true)", [b!.id]);
    await expect(db.query(
      "INSERT INTO messages(id, tenant_id, case_id, role, body) VALUES($1, $2, $3, 'customer', 'x')",
      [randomUUID(), b!.id, c.id]
    )).rejects.toThrow(/tenant_case_fk|foreign key/i);
    await db.query("ROLLBACK");
  });

  it("consumes bootstrap codes exactly once with expiry", async () => {
    const tenant = await store.getTenantBySlug("demo-phoenix-appliance");
    const deps = { store, provider: new FixtureProvider(), storageGet: async () => null as unknown as Buffer };
    const c = await createCase(deps, tenant!, "widget");
    const { newBootstrapCode } = await import("../src/server/auth.js");
    const code = newBootstrapCode();
    await store.createSession({
      id: randomUUID(), tenantId: tenant!.id, caseId: c.id,
      tokenHash: sha256("ct_x"), bootstrapCodeHash: sha256(code), bootstrapUsed: false,
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const first = await store.consumeBootstrap(sha256(code), new Date().toISOString());
    expect(first?.caseId).toBe(c.id);
    const second = await store.consumeBootstrap(sha256(code), new Date().toISOString());
    expect(second).toBeNull();
  });

  it("leases and completes jobs through the worker path", async () => {
    const tenant = await store.getTenantBySlug("demo-phoenix-appliance");
    const now = new Date().toISOString();
    await store.enqueueJob({
      id: randomUUID(), tenantId: tenant!.id, caseId: null, kind: "webhook",
      payload: { eventType: "case.status_updated" }, status: "pending",
      attempts: 0, maxAttempts: 3, leaseUntil: null, lastError: null, createdAt: now, updatedAt: now,
    });
    // Drain: earlier tests may have enqueued their own webhook jobs.
    const seen: string[] = [];
    for (let i = 0; i < 10; i++) {
      const leased = await store.leaseJob(new Date().toISOString());
      if (!leased) break;
      seen.push(leased.id);
      await store.completeJob(leased.id);
    }
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(await store.leaseJob(new Date().toISOString())).toBeNull();
  });

  it("staff login data and service keys round-trip", async () => {
    const tenant = await store.getTenantBySlug("demo-phoenix-appliance");
    const user = await store.getStaffByEmail(tenant!.id, "tech@demo-phoenix.invalid");
    expect(user?.role).toBe("technician");
    expect(await store.getStaffById(tenant!.id, user!.id)).not.toBeNull();
    const cred = await store.getServiceCredentialByHash(sha256("sk_demo_phoenix_001_SECRET"));
    expect(cred?.scopes).toContain("handoff:read");
  });
});

describe("SQL durable outbox", () => {
  it("rolls back case, assessment, snapshot and audit when outbox insertion fails", async () => {
    const tenant = (await store.getTenantBySlug("demo-phoenix-appliance"))!;
    const base = adapter(db);
    const brokenPool: PgPoolLike = { ...base, connect: async () => {
      const client = await base.connect();
      return { ...client, query: async (sql, params) => {
        if (sql.startsWith("INSERT INTO background_jobs")) throw new Error("injected outbox failure");
        return client.query(sql, params);
      }};
    }};
    const deps = {store:new PgStore(brokenPool),provider:new FixtureProvider(),storageGet:async()=>null};
    const c=await createCase(deps,tenant,"widget");c.conversationPhase="review";await store.updateCase(c);
    await expect(submitCase(deps,tenant,c.id,{acknowledgeIncomplete:true})).rejects.toThrow("injected outbox");
    expect((await store.getCase(tenant.id,c.id))?.submittedAt).toBeNull();
    expect(await store.getAssessment(tenant.id,c.id)).toBeNull();
    expect(await store.listHandoffs(tenant.id,c.id)).toHaveLength(0);
    expect((await store.listEvents(tenant.id,c.id)).some(e=>e.type==="case_submitted")).toBe(false);
    expect((await store.listJobs(tenant.id)).filter(j=>j.caseId===c.id)).toHaveLength(0);
  });
  it("persists scheduled availability across store reconstruction and denies cross-tenant retry",async()=>{
    const tenant=(await store.getTenantBySlug("demo-phoenix-appliance"))!;
    const c=await createCase({store,provider:new FixtureProvider(),storageGet:async()=>null},tenant,"widget");
    const time=new Date().toISOString();const id=randomUUID();
    await store.enqueueJob({id,tenantId:tenant.id,caseId:c.id,kind:"test",payload:{},status:"pending",attempts:0,maxAttempts:3,leaseUntil:null,lastError:null,createdAt:time,updatedAt:time,availableAt:"2099-01-01T00:00:00.000Z"});
    const restarted=new PgStore(adapter(db));
    expect((await restarted.listJobs(tenant.id)).find(j=>j.id===id)?.availableAt).toBe("2099-01-01T00:00:00.000Z");
    // No future job may be returned even when other tests left pending work.
    let leased;for(let i=0;i<50;i++){leased=await restarted.leaseJob(time);if(!leased)break;expect(leased.id).not.toBe(id);await restarted.completeJob(leased.id);}
    expect(leased).toBeNull();
    await restarted.failJob(id,"test","2099-02-01T00:00:00.000Z");
    expect((await restarted.listJobs(tenant.id)).find(j=>j.id===id)?.availableAt).toBe("2099-02-01T00:00:00.000Z");
    await restarted.failJob(id,"terminal",null);
    expect(await restarted.retryJob("tnt_demo_harbor",id)).toBe(false);
    expect(await restarted.retryJob(tenant.id,id)).toBe(true);
  });
});

it.skipIf(!process.env.TEST_POSTGRES_URL)("serializes concurrent SQL submissions with one stable outbox",async()=>{
  const tenant=(await store.getTenantBySlug("demo-phoenix-appliance"))!;
  const deps={store,provider:new FixtureProvider(),storageGet:async()=>null};
  const c=await createCase(deps,tenant,"widget");c.conversationPhase="review";await store.updateCase(c);
  const results=await Promise.all(Array.from({length:5},()=>submitCase(deps,tenant,c.id,{acknowledgeIncomplete:true})));
  expect(results.map(r=>r.handoffVersion)).toEqual([1,1,1,1,1]);
  expect(await store.listHandoffs(tenant.id,c.id)).toHaveLength(1);
  expect((await store.listJobs(tenant.id)).filter(j=>j.caseId===c.id&&j.kind==="webhook")).toHaveLength(1);
});

it("persists endpoint progress under a stable UUID event and isolates delivery lookup",async()=>{
 const tenant=(await store.getTenantBySlug("demo-phoenix-appliance"))!;const endpointId=randomUUID(),eventId=randomUUID(),id=randomUUID();
 await store.saveEndpoint({id:endpointId,tenantId:tenant.id,url:"https://test.example.invalid/hook",secret:"synthetic-test-secret",events:[],active:false});
 expect(await store.listDeliveries(tenant.id,eventId)).toEqual([]);
 await store.saveDelivery({id,tenantId:tenant.id,endpointId,eventId,eventType:"case.submitted",status:"failed",attempts:1,lastError:"synthetic failure",createdAt:new Date().toISOString()});
 await store.saveDelivery({id,tenantId:tenant.id,endpointId,eventId,eventType:"case.submitted",status:"delivered",attempts:2,lastError:null,createdAt:new Date().toISOString()});
 expect(await store.listDeliveries(tenant.id,eventId)).toHaveLength(1);
 expect((await store.listDeliveries(tenant.id,eventId))[0]).toMatchObject({status:"delivered",attempts:2,eventId});
 expect(await store.listDeliveries("tnt_demo_harbor",eventId)).toEqual([]);
});

it("expires only scoped inactive SQL cases and atomically retains private deletion work",async()=>{
 const tenant=(await store.getTenantBySlug("demo-phoenix-appliance"))!,other=(await store.getTenantBySlug("demo-harbor-warranty"))!;
 const deps={store,provider:new FixtureProvider(),storageGet:async()=>null};
 const old=await createCase(deps,tenant,"widget"),active=await createCase(deps,tenant,"widget"),foreign=await createCase(deps,other,"widget");
 await store.addAttachment({id:randomUUID(),caseId:old.id,tenantId:tenant.id,kind:"other",mimeType:"image/webp",sizeBytes:10,storageKey:`${old.id}/private.webp`,sha256:"normalized-test-hash",sourceSha256:"source-test-hash",rawOcrText:null,createdAt:new Date().toISOString()});
 expect((await store.listAttachments(tenant.id,old.id))[0].sourceSha256).toBe("source-test-hash");
 for(const record of [old,foreign]){
  const client=await adapter(db).connect();try{await client.query("BEGIN");await client.query("SELECT set_config('app.tenant_id',$1,true)",[record.tenantId]);await client.query("UPDATE cases SET updated_at=now()-interval '400 days' WHERE tenant_id=$1 AND id=$2",[record.tenantId,record.id]);await client.query("COMMIT");}finally{client.release();}
 }
 await store.purgeExpired(tenant,new Date().toISOString());
 expect(await store.getCase(tenant.id,old.id)).toBeNull();expect(await store.getCase(tenant.id,active.id)).not.toBeNull();expect(await store.getCase(other.id,foreign.id)).not.toBeNull();
 expect(await store.listAttachments(tenant.id,old.id)).toHaveLength(0);
 expect((await store.listJobs(tenant.id)).some(j=>j.kind==="storage_delete"&&j.caseId===null&&(j.payload.keys as string[]).includes(`${old.id}/private.webp`))).toBe(true);
});
