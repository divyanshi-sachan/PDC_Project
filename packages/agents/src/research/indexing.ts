import { chunks, type Db, eq, sql } from "@dealpilot/db";
import { type EdgarClient, type Embedder, indexFiling } from "@dealpilot/sources";

export interface IndexDeps {
  edgar: EdgarClient;
  db: Db;
  embedder: Embedder;
}

/**
 * Index the company's latest 10-K (Items 1, 1A, 7 by default) into `chunks`. Skips work when that accession already
 * has chunks (`reused: true`).
 */
export async function indexLatestTenK(
  deps: IndexDeps,
  ticker: string,
  opts: { items?: string[] } = {},
): Promise<{ accession: string; chunks: number; reused: boolean }> {
  const { edgar, db, embedder } = deps;
  const [filing] = await edgar.filings(ticker, { form: "10-K", limit: 1 });
  if (!filing) throw new Error(`indexLatestTenK(${ticker}): no 10-K found`);

  const [existing] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(chunks)
    .where(eq(chunks.accession, filing.accession));
  if (existing && existing.n > 0) return { accession: filing.accession, chunks: existing.n, reused: true };

  const company = await edgar.company(ticker);
  const sections = await edgar.sections(filing.accession, (opts.items ?? ["1", "1A", "7"]).join(","));
  if (sections.length === 0)
    throw new Error(`indexLatestTenK(${ticker}): no sections returned for ${filing.accession}`);
  const n = await indexFiling(
    db,
    embedder,
    {
      cik: company.cik,
      ticker: company.ticker,
      companyName: company.name,
      accession: filing.accession,
      form: filing.form,
      filed: filing.filed,
      periodOfReport: filing.period_of_report,
      url: filing.primary_document_url,
    },
    sections.map((s) => ({ item: s.item, text: s.text })),
  );
  return { accession: filing.accession, chunks: n, reused: false };
}
