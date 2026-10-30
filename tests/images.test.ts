import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeImage, inferenceImage, INFERENCE_IMAGE_BYTES, MODEL_REQUEST_BYTES } from "../src/integrations/storage/images.js";
import { MetaProvider } from "../src/integrations/meta/meta.js";
import { FilesystemStorage } from "../src/integrations/storage/storage.js";

const photo=()=>sharp({create:{width:2400,height:1800,channels:3,background:"white"}}).composite([{input:Buffer.from('<svg width="2000" height="1000"><text x="80" y="500" font-size="100">MODEL WM3900HBA SERIAL 123456789</text></svg>')}]);
describe("private bounded images",()=>{
  it.each(["jpeg","png","webp"] as const)("decodes %s, preserves dimensions, and strips metadata",async format=>{
    const input=await photo().withMetadata({orientation:6}).toFormat(format).toBuffer();
    const normalized=await sanitizeImage(input);const meta=await sharp(normalized).metadata();
    expect(meta.exif).toBeUndefined();expect(meta.icc).toBeUndefined();expect(meta.xmp).toBeUndefined();
    expect([meta.width,meta.height]).toEqual([1800,2400]);
    const derivative=await inferenceImage(normalized);
    expect(derivative.length).toBeLessThanOrEqual(INFERENCE_IMAGE_BYTES);
    const small=await sharp(derivative).metadata();expect(Math.max(small.width!,small.height!)).toBeGreaterThanOrEqual(1280);
  });
  it("rejects malformed files, excessive bytes and pixel bombs",async()=>{
    await expect(sanitizeImage(Buffer.from("not a photo"))).rejects.toThrow("Invalid");
    await expect(sanitizeImage(Buffer.alloc(8*1024*1024+1))).rejects.toThrow();
    const huge=await sharp({create:{width:5001,height:5001,channels:3,background:"white"}}).png().toBuffer();
    await expect(sanitizeImage(huge)).rejects.toThrow("Invalid");
  });
  it("keeps a representative label within the full serialized Meta ceiling without making live calls",async()=>{
    const image=await inferenceImage(await sanitizeImage(await photo().png().toBuffer()));
    const dir=mkdtempSync(join(tmpdir(),"image-budget-"));
    vi.stubEnv("META_USAGE_LEDGER",join(dir,"usage.json"));vi.stubEnv("META_IMAGE_BILLING_REVIEWED","1");
    const fetcher=vi.spyOn(globalThis,"fetch").mockImplementation(async (_url,opts)=>{
      expect(Buffer.byteLength(String(opts?.body))).toBeLessThanOrEqual(MODEL_REQUEST_BYTES);
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({rawText:"MODEL WM3900HBA",uncertainty:[],ambiguousChars:false})}}],usage:{prompt_tokens:100,completion_tokens:50}}));
    });
    try{
      await new MetaProvider("test-key").extractApplianceLabel({tenantId:"test",caseId:"image-test",attachmentId:"photo",imageBase64:image.toString("base64"),mimeType:"image/jpeg"});
      expect(fetcher).toHaveBeenCalledTimes(1);
    }finally{fetcher.mockRestore();vi.unstubAllEnvs();}
  });
  it("rejects traversal and supports idempotent private file deletion",async()=>{
    const storage=new FilesystemStorage(mkdtempSync(join(tmpdir(),"private-images-")));
    const saved=await storage.put("case-1","../../label.png",Buffer.from("private"));
    expect(await storage.get("../other-secret")).toBeNull();
    await expect(storage.delete("../other-secret")).rejects.toThrow("Invalid");
    await storage.delete(saved.storageKey);await storage.delete(saved.storageKey);
    expect(await storage.get(saved.storageKey)).toBeNull();
  });
});

it("bounds simultaneous decoding work",async()=>{
 const input=await sharp({create:{width:1600,height:1200,channels:3,background:"white"}}).png().toBuffer();
 const results=await Promise.allSettled([sanitizeImage(input),sanitizeImage(input),sanitizeImage(input)]);
 expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
});
