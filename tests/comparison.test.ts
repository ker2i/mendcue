import { it,expect } from "vitest";
import sharp from "sharp";
import { MemoryStore } from "../src/db/memory.js";
import { seedStore } from "../src/db/seed.js";
import { FixtureProvider } from "../src/integrations/meta/fixture.js";
import { prepareComparison } from "../src/evaluation/product-comparison.js";
import type { ModelProvider,AssessmentInput } from "../src/integrations/meta/provider.js";

it("compares the real submitted service brief with equivalent fixed facts/images and no outcomes",async()=>{
 const store=new MemoryStore();await seedStore(store);const tenant=(await store.listTenants())[0];
 const fixture=new FixtureProvider();let called:AssessmentInput|undefined;
 const model:ModelProvider={mode:"live",extractIntakeTurn:fixture.extractIntakeTurn.bind(fixture),extractApplianceLabel:fixture.extractApplianceLabel.bind(fixture),assessCase:async i=>{called=i;return fixture.assessCase(i);}};
 const image=await sharp({create:{width:1600,height:1200,channels:3,background:"white"}}).png().toBuffer();
 const pair=await prepareComparison({tenant,documents:[],chunks:[],facts:[{id:"f1",key:"problem_description",value:"Washer stopped with standing water"}],images:[image]},model);
 expect(called).toBeUndefined(); // Preflight never calls a model.
 expect(pair.input.images).toHaveLength(1);
 const result=await pair.runProduct();expect(result.status).toBe("ok");
 expect(called).toEqual(pair.input);expect(result.snapshot.handoff_version).toBe(1);
 expect(result.brief.complaint).toContain("standing water");expect(result.snapshot.model_mode).toBe("live");
 expect(JSON.stringify(pair.input)).not.toContain("confirmedIssue");
});

it("runs both complete-brief systems with equivalent images, model and output budgets using only synthetic mocked Meta responses",async()=>{
 const {vi}=await import("vitest");const {MetaProvider}=await import("../src/integrations/meta/meta.js");
 const {mkdtempSync}=await import("node:fs");const {tmpdir}=await import("node:os");const {join}=await import("node:path");
 vi.stubEnv("META_IMAGE_BILLING_REVIEWED","1");vi.stubEnv("META_USAGE_LEDGER",join(mkdtempSync(join(tmpdir(),"paired-meta-")),"usage.json"));
 const calls:Record<string,any>[]=[];
 const mocked=vi.spyOn(globalThis,"fetch").mockImplementation(async (_url,opts)=>{
  const body=JSON.parse(String(opts?.body));calls.push(body);
  const output=body.response_format.json_schema.name==="technician_brief"?{identity:"Unconfirmed",complaint:"Washer stopped",safety:"Unknown",observations:["Customer reports stopped cycle"],issueAreas:[],missingInformation:["Timeline"],followup:"Contact customer",contact:"Not collected",documentation:[]}:{hypotheses:[],recommendedFollowUp:"Contact customer"};
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:100,completion_tokens:100}}));
 });
 try{
  const store=new MemoryStore();await seedStore(store);const tenant=(await store.listTenants())[0];
  const image=await sharp({create:{width:1600,height:1200,channels:3,background:"white"}}).png().toBuffer();
  const provider=new MetaProvider("test-not-a-live-key");const pair=await prepareComparison({tenant,documents:[],chunks:[],facts:[{id:"f1",key:"problem_description",value:"Washer stopped"}],images:[image]},provider);
  const product=await pair.runProduct();const baseline=await provider.draftServiceBrief(pair.input,"Synthetic test baseline");
  expect(product.status).toBe("ok");expect(baseline.complaint).toBe("Washer stopped");expect(calls).toHaveLength(2);
  expect(calls[0].messages[1].content).toEqual(calls[1].messages[1].content);
  expect(calls.map(c=>[c.model,c.max_tokens])).toEqual([["muse-spark-1.3",2048],["muse-spark-1.3",2048]]);
 }finally{mocked.mockRestore();vi.unstubAllEnvs();}
});
