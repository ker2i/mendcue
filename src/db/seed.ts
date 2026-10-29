// Seed runner: demo tenants, approved playbook knowledge, demo staff, demo service key.
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PgStore } from "./pg.js";
import { MemoryStore } from "./memory.js";
import type { Store } from "./store.js";
import { DEMO_SERVICE_KEY_A, DEMO_STAFF, demoChunks, demoDocuments, demoTenants } from "../content/seed.js";
import { hashPassword, sha256 } from "../server/auth.js";

export async function seedStore(store: Store): Promise<void> {
  for (const t of demoTenants()) await store.saveTenant(t);
  for (const d of demoDocuments()) await store.saveDocument(d);
  for (const c of demoChunks()) await store.saveChunk(c);
  const tenants = await store.listTenants();
  for (const s of DEMO_STAFF) {
    const t = tenants.find((x) => x.slug === s.tenantSlug);
    if (!t) continue;
    await store.saveStaffUser({
      id: randomUUID(), tenantId: t.id, email: s.email,
      passwordHash: await hashPassword(s.password), role: s.role, name: s.name,
    });
  }
  const a = tenants.find((x) => x.slug === "demo-phoenix-appliance");
  if (a) {
    await store.saveServiceCredential({
      id: randomUUID(), tenantId: a.id, name: "demo-receiver",
      keyHash: sha256(DEMO_SERVICE_KEY_A), scopes: ["handoff:read", "sessions:write"],
      createdAt: new Date().toISOString(),
    });
  }
}

export function memoryWithSeed(): MemoryStore {
  const store = new MemoryStore();
  // Seeding is async; callers in tests await seedStore explicitly.
  return store;
}

const isMain = process.argv[1]?.endsWith("seed.js");
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  try {
    await seedStore(new PgStore(pool));
    console.log("Seed complete: 2 demo tenants, example playbooks, demo staff, demo service key.");
    console.log("WARNING: demo credentials are published in source. Rotate them and remove demo tenants before any real use.");
  } finally {
    await pool.end();
  }
}
