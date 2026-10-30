import { it,expect,vi } from "vitest";
import net from "node:net";
import { sendNotification } from "../src/integrations/notifications.js";
import type { JobRecord } from "../src/db/store.js";

it("sends only a reference and authenticated staff link to a local SMTP receiver",async()=>{
 let message="";const sockets=new Set<net.Socket>();
 const server=net.createServer(socket=>{
  sockets.add(socket);socket.on("close",()=>sockets.delete(socket));socket.write("220 local test SMTP\r\n");
  let buffer="",data=false;
  socket.on("data",chunk=>{
   buffer+=chunk.toString();
   while(buffer.includes("\r\n")){
    const i=buffer.indexOf("\r\n");const line=buffer.slice(0,i);buffer=buffer.slice(i+2);
    if(data){if(line==="."){data=false;socket.write("250 queued\r\n");}else message+=line+"\r\n";continue;}
    if(/^EHLO/.test(line))socket.write("250-local\r\n250 SIZE 100000\r\n");
    else if(line==="DATA"){data=true;socket.write("354 send message\r\n");}
    else if(line==="QUIT"){socket.end("221 bye\r\n");}
    else socket.write("250 OK\r\n");
   }
  });
 });
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 vi.stubEnv("NODE_ENV","test");vi.stubEnv("SMTP_HOST","127.0.0.1");vi.stubEnv("SMTP_PORT",String((server.address()as net.AddressInfo).port));vi.stubEnv("SMTP_FROM","intake@example.invalid");vi.stubEnv("SMTP_USER","");
 const now=new Date().toISOString();
 const job:JobRecord={id:"test-message-id",tenantId:"test-tenant",caseId:"test-case",kind:"notification",payload:{to:"tech@example.invalid",reference:"MC-TEST",staffUrl:"https://intake.example.invalid/staff#case=test-case"},status:"leased",attempts:1,maxAttempts:3,leaseUntil:null,lastError:null,createdAt:now,updatedAt:now};
 try{
  await sendNotification(job);
  expect(message).toContain("MC-TEST");expect(message).toContain("/staff#case=test-case");expect(message).toContain("test-message-id@mendcue.local");
  expect(message).not.toMatch(/password|transcript|image\/|base64/i);
 }finally{vi.unstubAllEnvs();for(const s of sockets)s.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
