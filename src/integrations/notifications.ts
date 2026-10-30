import type { JobRecord } from "../db/store.js";
export async function sendNotification(job: JobRecord) {
  const host=process.env.SMTP_HOST;
  const from=process.env.SMTP_FROM;
  const port=Number(process.env.SMTP_PORT??465);
  if(!host||!from||!Number.isInteger(port)||port<1||port>65535)throw new Error("SMTP configuration missing or invalid");
  const {default: nodemailer}=await import("nodemailer");
  const secure=port===465;
  const transport=nodemailer.createTransport({host,port,secure,requireTLS:!secure&&process.env.NODE_ENV!=="test",
    auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}:undefined,
    connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000});
  try {
    const result=await transport.sendMail({from,to:String(job.payload.to),subject:`Service request ${String(job.payload.reference)}`,
      messageId:`<${job.id}@mendcue.local>`,text:`A new service request (${String(job.payload.reference)}) is ready for review.\nSign in to review: ${String(job.payload.staffUrl)}\n`});
    if(!result.accepted?.length||result.rejected?.length)throw new Error("SMTP recipient not accepted");
  }finally{transport.close();}
}
