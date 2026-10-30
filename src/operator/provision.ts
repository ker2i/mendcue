// Private operator tool. Passwords arrive through stdin, never process arguments.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { z } from "zod";
import { PgStore } from "../db/pg.js";
import type { Store } from "../db/store.js";
import { hashPassword } from "../server/auth.js";
import { tenantConfigSchema } from "../tenant-config.js";

export async function provision(store: Store, input: unknown, email: string, name: string, password: string) {
  const tenant=tenantConfigSchema.parse(input);
  z.string().email().parse(email);z.string().min(1).max(160).parse(name);
  if(password.length<16||password.length>256)throw new Error("Use a password between 16 and 256 characters");
  if(await store.getTenant(tenant.id)||await store.getTenantBySlug(tenant.slug)||await store.getTenantByPublicKey(tenant.publicKey))throw new Error("Tenant already exists; use rotation for existing staff");
  const passwordHash=await hashPassword(password);
  await store.saveTenant(tenant);
  await store.saveStaffUser({id:randomUUID(),tenantId:tenant.id,email:email.toLowerCase(),name,role:"owner",passwordHash});
  return tenant;
}
async function main(){
  const [command,target,email,name]=process.argv.slice(2);
  if(!["provision","rotate"].includes(command)||!target||!email)throw new Error("Usage: provision <tenant.json> <email> <name> OR rotate <tenant-id> <email>; password via stdin");
  if(process.stdin.isTTY)throw new Error("Pipe password from a secret manager or a hidden shell prompt into stdin");
  let password="";
  for await(const chunk of process.stdin){password+=chunk.toString();if(password.length>1024)throw new Error("Password input too long");}
  password=password.replace(/\r?\n$/,"");
  if(password.length<16||password.length>256)throw new Error("Password must contain 16–256 characters");
  if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is required; demo seeding is separate");
  const pool=new Pool({connectionString:process.env.DATABASE_URL});const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const store=new PgStore({query:(...args)=>client.query(...args),connect:async()=>({query:(...args)=>client.query(...args),release(){}})},(...args)=>client.query(...args));
    if(command==="provision"){
      const input=JSON.parse(readFileSync(target,"utf8"));
      await client.query("SELECT set_config('app.tenant_id',$1,true)",[tenantConfigSchema.parse(input).id]);
      const tenant=await provision(store,input,email,name??"Owner",password);
      console.log(`Provisioned ${tenant.slug}. Hosted intake: /business/${tenant.slug}; staff: /staff`);
    }else{
      await client.query("SELECT set_config('app.tenant_id',$1,true)",[target]);
      const user=await store.getStaffByEmail(target,email);
      if(!user)throw new Error("Staff user not found");
      await store.saveStaffUser({...user,passwordHash:await hashPassword(password)});
      await client.query("DELETE FROM staff_sessions WHERE tenant_id=$1 AND user_id=$2",[target,user.id]);
      console.log("Password rotated; existing staff sessions revoked.");
    }
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error("Operator command failed; validate arguments, tenant configuration and database access. No secrets printed.");process.exitCode=1;});
