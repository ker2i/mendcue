import { z } from "zod";
const origin = z.string().url().refine(value => { const u=new URL(value); return ["https:","http:"].includes(u.protocol)&&u.origin===value; }, "Use an exact HTTP(S) origin without a trailing slash");
export const tenantConfigSchema = z.object({
  id:z.string().regex(/^[a-zA-Z0-9_-]{3,80}$/),slug:z.string().regex(/^[a-z0-9-]{3,80}$/),name:z.string().min(1).max(160),demoLabel:z.string().max(160),
  orgType:z.enum(["solo_repair","repair_company","home_warranty","insurance"]),
  branding:z.object({primaryColor:z.string().regex(/^#[a-fA-F0-9]{6}$/),logoUrl:z.string().url().nullable()}),
  contact:z.object({email:z.string().email().nullable(),phone:z.string().max(60).nullable()}),
  timezone:z.string().refine(v=>{try{new Intl.DateTimeFormat("en",{timeZone:v});return true;}catch{return false;}}),languages:z.array(z.string().min(2)).min(1),
  allowedOrigins:z.array(origin).max(20),publicKey:z.string().min(20).max(200),categories:z.array(z.string()).min(1),detailedCategories:z.array(z.string()),
  serviceZips:z.array(z.string().regex(/^\d{5}$/)).nullable(),requireStreetAddress:z.boolean(),requiredFields:z.array(z.string()),playbookVersions:z.record(z.string()),
  routing:z.object({destination:z.string(),queue:z.string().min(1)}),notifications:z.object({emailEnabled:z.boolean(),emailTo:z.string().email().nullable()}).refine(v=>!v.emailEnabled||!!v.emailTo),
  retention:z.object({draftDays:z.number().int().min(1).max(365),closedDays:z.number().int().min(1).max(3650),logDays:z.number().int().min(1).max(365)}),
  privacyText:z.string().min(1),openingMessage:z.string().min(1),gasUtilityContact:z.string(),featureFlags:z.object({photos:z.boolean(),knowledge:z.boolean(),recall:z.boolean()}),
}).strict();
