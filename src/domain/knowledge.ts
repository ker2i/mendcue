// Approved knowledge model: documents, chunks, applicability, retrieval order.
export interface KnowledgeDocument {
  id: string;
  tenantId: string | null; // null = shared
  visibility: "shared" | "tenant_private";
  publisher: string;
  usageBasis?: string;
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

export type KnowledgeLevel = "exact_model" | "verified_family" | "category_only" | "unknown";

export interface EvidenceReference {
  documentId: string; documentVersion: string; documentHash: string;
  title: string; sourceUrl: string | null; pdfPageIndex: number | null;
  printedPageLabel: string | null; chunkId: string; excerpt: string;
  applicabilityBasis: string;
}
export interface RetrievalHit { chunk: KnowledgeChunk; level: KnowledgeLevel; basis: string }
export function normalizeModel(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s_]+/g, "");
}
const brandKey = (raw: string) => raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

// Family identifiers are reviewed membership sets, never inferred prefixes.
// explicitFamilies and chunk families contain the same opaque family ID;
// explicitModels lists every reviewed member of that family.
export function retrieveKnowledge(args: {
  chunks: KnowledgeChunk[]; documents: Map<string, KnowledgeDocument>;
  tenantId: string; modelNormalized: string | null; brand: string | null;
  category: string | null; query: string; limit?: number;
}): RetrievalHit[] {
  const hits: Array<RetrievalHit & { score: number }> = [];
  const model = args.modelNormalized ? normalizeModel(args.modelNormalized) : null;
  for (const c of args.chunks) {
    const d = args.documents.get(c.documentId);
    if (!d || d.reviewStatus !== "approved" || c.version !== d.version) continue;
    if (d.visibility !== c.visibility || d.tenantId !== c.tenantId) continue;
    if (d.visibility === "tenant_private" && d.tenantId !== args.tenantId) continue;
    const brandMatches = !!d.brand && !!args.brand && brandKey(d.brand) === brandKey(args.brand);
    const member = !!model && d.explicitModels.map(normalizeModel).includes(model);
    let level: KnowledgeLevel, basis: string;
    if (brandMatches && member && c.applicability.models.map(normalizeModel).includes(model!)) {
      level = "exact_model"; basis = `Reviewed ${d.brand} model ${model}`;
    } else if (brandMatches && member && c.applicability.families.some(f => d.explicitFamilies.includes(f))) {
      level = "verified_family"; basis = `Reviewed family membership for ${d.brand} ${model}`;
    } else {
      // A restricted manual/section must never fall through to category retrieval.
      if (d.explicitModels.length || d.explicitFamilies.length || c.applicability.models.length || c.applicability.families.length) continue;
      if (d.brand && !brandMatches) continue;
      if (!(args.category && c.applicability.categories.includes(args.category)) && !c.applicability.categories.includes("general")) continue;
      level = "category_only"; basis = "Generic category guidance; no model applicability established";
    }
    const tokens = args.query.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);
    const overlap = tokens.filter(t => c.text.toLowerCase().includes(t)).length;
    hits.push({ chunk: c, level, basis, score: ({ exact_model: 3000, verified_family: 2000, category_only: 1000, unknown: 0 })[level] + overlap });
  }
  return hits.sort((a,b) => b.score - a.score).slice(0, args.limit ?? 4).map(({ score, ...hit }) => hit);
}
export function evidenceReference(hit: RetrievalHit, documents: Map<string, KnowledgeDocument>): EvidenceReference {
  const d = documents.get(hit.chunk.documentId)!;
  return { documentId: d.id, documentVersion: d.version, documentHash: d.hash,
    title: d.title, sourceUrl: d.sourceUrl, pdfPageIndex: hit.chunk.pageIndex,
    printedPageLabel: hit.chunk.pageLabel, chunkId: hit.chunk.id,
    excerpt: hit.chunk.text, applicabilityBasis: hit.basis };
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
