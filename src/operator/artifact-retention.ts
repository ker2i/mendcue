import { readdir, lstat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
// Only explicitly configured, tenant-scoped exports; never the model usage ledger.
export async function pruneArtifacts(root:string,tenantId:string,days:number,now=Date.now()){
 if(!/^[a-zA-Z0-9_-]+$/.test(tenantId))throw new Error("Invalid artifact tenant path");
 const dir=resolve(root,tenantId);
 try{
  if((await lstat(dir)).isSymbolicLink())throw new Error("Artifact tenant directory may not be a symlink");
  for(const entry of await readdir(dir,{withFileTypes:true})){
   if(!entry.isFile()||!/(\.private\.json|\.blind\.json|\.key\.json|\.grades\.json|\.grades\.csv)$/.test(entry.name))continue;
   const path=resolve(dir,entry.name),info=await lstat(path);
   if(info.isFile()&&!info.isSymbolicLink()&&info.mtimeMs<now-days*86400000)await unlink(path);
  }
 }catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
}
