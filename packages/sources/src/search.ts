import { chunks, type Db } from "@dealpilot/db";
import { and, eq, sql } from "drizzle-orm";
import type { Embedder } from "./embeddings.ts";

export interface SearchHit {
  id: string;
  accession: string;
  section: string;
  text: string;
  charStart: number;
  charEnd: number;
  score: number;
  /** 1-based rank in each retriever (null = not retrieved by it). */
  vectorRank: number | null;
  textRank: number | null;
}

/**
 * Reciprocal Rank Fusion: score(d) = Σ_r 1 / (k + rank_r(d)).
 * Pure; ranks are 1-based. k=60 is the standard constant from Cormack et al. (2009).
 */
export function reciprocalRankFusion(
  rankings: { ids: string[] }[],
  k = 60,
): { id: string; score: number; ranks: (number | null)[] }[] {
  const scores = new Map<string, { score: number; ranks: (number | null)[] }>();
  rankings.forEach((r, ri) => {
    r.ids.forEach((id, i) => {
      const entry = scores.get(id) ?? { score: 0, ranks: rankings.map(() => null) };
      entry.score += 1 / (k + i + 1);
      entry.ranks[ri] = i + 1;
      scores.set(id, entry);
    });
  });
  return [...scores.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export interface HybridSearchParams {
  query: string;
  cik?: string;
  accession?: string;
  section?: string;
  k?: number;
  /** Candidates fetched from each retriever before fusion. */
  candidates?: number;
}

/** Hybrid retrieval over filing chunks: pgvector cosine (halfvec HNSW) + Postgres full-text, fused with RRF. */
export async function hybridSearch(db: Db, embedder: Embedder, p: HybridSearchParams): Promise<SearchHit[]> {
  const k = p.k ?? 8;
  const n = p.candidates ?? 40;
  const filters = [
    p.cik ? eq(chunks.cik, p.cik) : undefined,
    p.accession ? eq(chunks.accession, p.accession) : undefined,
    p.section ? eq(chunks.section, p.section) : undefined,
  ].filter((x) => x !== undefined);
  const where = filters.length ? and(...filters) : undefined;

  const [qv] = await embedder.embed([p.query], "query");
  if (!qv) throw new Error("embedder returned no query vector");
  const vecLiteral = `[${qv.join(",")}]`;

  const byVector = await db
    .select({ id: chunks.id })
    .from(chunks)
    .where(and(where, sql`${chunks.embedding} is not null`))
    .orderBy(sql`${chunks.embedding} <=> ${vecLiteral}::halfvec`)
    .limit(n);

  const tsq = sql`websearch_to_tsquery('english', ${p.query})`;
  const byText = await db
    .select({ id: chunks.id })
    .from(chunks)
    .where(and(where, sql`${chunks.tsv} @@ ${tsq}`))
    .orderBy(sql`ts_rank_cd(${chunks.tsv}, ${tsq}) desc`)
    .limit(n);

  const fused = reciprocalRankFusion([
    { ids: byVector.map((r) => r.id) },
    { ids: byText.map((r) => r.id) },
  ]).slice(0, k);
  if (fused.length === 0) return [];

  const rows = await db
    .select({
      id: chunks.id,
      accession: chunks.accession,
      section: chunks.section,
      text: chunks.text,
      charStart: chunks.charStart,
      charEnd: chunks.charEnd,
    })
    .from(chunks)
    .where(sql`${chunks.id} in ${fused.map((f) => f.id)}`);
  const byId = new Map(rows.map((r) => [r.id, r]));

  return fused.flatMap((f) => {
    const row = byId.get(f.id);
    return row
      ? [{ ...row, score: f.score, vectorRank: f.ranks[0] ?? null, textRank: f.ranks[1] ?? null }]
      : [];
  });
}
