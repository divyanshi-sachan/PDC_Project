import { chunks, companies, type Db, filings } from "@dealpilot/db";
import { sql } from "drizzle-orm";
import { type ChunkOptions, chunkText } from "./chunking.ts";
import type { Embedder } from "./embeddings.ts";

export interface SectionInput {
  item: string; // "1", "1A", "7", ...
  text: string;
}

export interface FilingInput {
  cik: string;
  ticker: string;
  companyName: string;
  accession: string;
  form: string;
  filed: string; // ISO date
  periodOfReport: string | null;
  url: string | null;
}

/**
 * Chunk + embed + upsert a filing's sections. Idempotent: re-indexing the same
 * accession replaces its chunks. Returns the number of chunks written.
 */
export async function indexFiling(
  db: Db,
  embedder: Embedder,
  filing: FilingInput,
  sections: SectionInput[],
  opts: ChunkOptions & { embedBatch?: number } = {},
): Promise<number> {
  await db
    .insert(companies)
    .values({ cik: filing.cik, ticker: filing.ticker, name: filing.companyName })
    .onConflictDoUpdate({ target: companies.cik, set: { ticker: filing.ticker, name: filing.companyName } });
  await db
    .insert(filings)
    .values({
      accession: filing.accession,
      cik: filing.cik,
      form: filing.form,
      filed: filing.filed,
      periodOfReport: filing.periodOfReport,
      url: filing.url,
    })
    .onConflictDoNothing();

  const rows = sections.flatMap((s) =>
    chunkText(s.text, opts).map((c) => ({
      ...c,
      section: s.item,
      cik: filing.cik,
      accession: filing.accession,
    })),
  );
  const batch = opts.embedBatch ?? 64;
  const vectors: number[][] = [];
  for (let i = 0; i < rows.length; i += batch) {
    vectors.push(
      ...(await embedder.embed(
        rows.slice(i, i + batch).map((r) => r.text),
        "document",
      )),
    );
  }

  await db.transaction(async (tx) => {
    await tx.delete(chunks).where(sql`${chunks.accession} = ${filing.accession}`);
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(chunks).values(
        rows.slice(i, i + 500).map((r, j) => ({
          accession: r.accession,
          cik: r.cik,
          section: r.section,
          ordinal: r.ordinal,
          text: r.text,
          charStart: r.charStart,
          charEnd: r.charEnd,
          tokenCount: r.tokenCount,
          embedding: vectors[i + j] ?? null,
          embeddingModel: embedder.model,
        })),
      );
    }
  });
  return rows.length;
}
