// Approved knowledge model: documents, chunks, applicability, retrieval order.
export interface KnowledgeDocument {
  id: string;
  tenantId: string | null; // null = shared
  visibility: "shared" | "tenant_private";
  publisher: string;
  sourceUrl: string | null;
  documentType: string;
  title: string;
  language: string;
  brand: string | null;
  explicitModels: string[]; // exact normalized model strings covered
  explicitFamilies: string[]; // verified family prefixes/patterns
  retrievedAt: string;
  hash: string;
  version: string;
  reviewStatus: "draft" | "approved" | "retired";
  reviewedBy: string | null;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  tenantId: string | null;
  visibility: "shared" | "tenant_private";
  version: string;
  pageIndex: number;
  pageLabel: string | null;
  text: string;
  applicability: { models: string[]; families: string[]; categories: string[] };
}

export type KnowledgeLevel = "exact_model" | "category_family" | "unknown";

export interface RetrievalHit {
  chunk: KnowledgeChunk;
  level: KnowledgeLevel;
  basis: string;
}

export function normalizeModel(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s_]+/g, "");
}

// Retrieval order: exact model -> verified family -> brand/category -> generic playbook.
// Fuzzy text match NEVER establishes model applicability.
export function retrieveKnowledge(args: {
  chunks: KnowledgeChunk[];
  documents: Map<string, KnowledgeDocument>;
  tenantId: string;
  modelNormalized: string | null;
  brand: string | null;
  category: string | null;
  query: string;
  limit?: number;
}): RetrievalHit[] {
  const limit = args.limit ?? 4;
  const usable = args.chunks.filter((c) => {
    const doc = args.documents.get(c.documentId);
    if (!doc || doc.reviewStatus !== "approved") return false;
    if (c.visibility === "tenant_private" && c.tenantId !== args.tenantId) return false;
    if (doc.visibility === "tenant_private" && doc.tenantId !== args.tenantId) return false;
    return true;
  });

  const hits: RetrievalHit[] = [];
  const q = args.query.toLowerCase();

  // 1. Exact model
  if (args.modelNormalized) {
    for (const c of usable) {
      if (c.applicability.models.map(normalizeModel).includes(args.modelNormalized)) {
        hits.push({ chunk: c, level: "exact_model", basis: `exact model ${args.modelNormalized}` });
      }
    }
    if (hits.length >= limit) return hits.slice(0, limit);
  }
  // 2. Verified family (explicit prefix match on normalized model)
  if (args.modelNormalized) {
    for (const c of usable) {
      if (hits.some((h) => h.chunk.id === c.id)) continue;
      const fam = c.applicability.families.map(normalizeModel);
      if (fam.some((f) => f && args.modelNormalized!.startsWith(f))) {
        hits.push({ chunk: c, level: "category_family", basis: "verified model family" });
      }
    }
    if (hits.length >= limit) return hits.slice(0, limit);
  }
  // 3/4. Brand/category + generic playbook, ranked by token overlap.
  const scored: Array<{ c: KnowledgeChunk; score: number; level: KnowledgeLevel }> = [];
  for (const c of usable) {
    if (hits.some((h) => h.chunk.id === c.id)) continue;
    const doc = args.documents.get(c.documentId)!;
    let eligible = false;
    if (args.brand && doc.brand && doc.brand.toLowerCase() === args.brand.toLowerCase()) eligible = true;
    if (args.category && c.applicability.categories.includes(args.category)) eligible = true;
    if (c.applicability.categories.includes("general")) eligible = true;
    if (!eligible) continue;
    const text = c.text.toLowerCase();
    const tokens = q.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    let score = 0;
    for (const t of tokens) if (text.includes(t)) score++;
    scored.push({ c, score, level: "category_family" });
  }
  scored.sort((a, b) => b.score - a.score);
  for (const s of scored) {
    if (hits.length >= limit) break;
    hits.push({ chunk: s.c, level: s.level, basis: "brand/category playbook" });
  }
  return hits.slice(0, limit);
}

// Validate that citations reference supplied chunks.
export function validateCitations(
  citations: Array<{ chunkId: string }>,
  supplied: RetrievalHit[]
): { valid: boolean; invalidIds: string[] } {
  const ids = new Set(supplied.map((h) => h.chunk.id));
  const invalid = citations.filter((c) => !ids.has(c.chunkId)).map((c) => c.chunkId);
  return { valid: invalid.length === 0, invalidIds: invalid };
}
