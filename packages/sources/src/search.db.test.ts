/**
 * Integration test against a real Postgres+pgvector (local docker compose `db`).
 * Skips automatically when TEST_DATABASE_URL is not set.
 *   TEST_DATABASE_URL=postgres://dealpilot:dealpilot@localhost:5432/dealpilot pnpm test
 */
import { chunks, companies, createDb, filings } from "@dealpilot/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { fakeEmbedder } from "./embeddings.ts";
import { indexFiling } from "./ingest.ts";
import { hybridSearch } from "./search.ts";

const url = process.env.TEST_DATABASE_URL;
const CIK = "0009999999";
const ACC = "0009999999-26-000001";

describe.skipIf(!url)("indexFiling + hybridSearch (postgres)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  const embedder = fakeEmbedder();

  afterAll(async () => {
    await db.delete(chunks).where(eq(chunks.accession, ACC));
    await db.delete(filings).where(eq(filings.accession, ACC));
    await db.delete(companies).where(eq(companies.cik, CIK));
    await close();
  });

  test("indexes sections and retrieves the relevant chunk with exact offsets", async () => {
    const mdna =
      "Net sales increased 6% driven by services revenue.\n\nGross margin expanded to 46.2% on mix.\n\n" +
      "Operating expenses grew 4% due to research and development headcount.";
    const risk =
      "We face intense competition.\n\nSupply chain disruptions in Asia could adversely affect results.";
    const n = await indexFiling(
      db,
      embedder,
      {
        cik: CIK,
        ticker: "TEST",
        companyName: "Test Corp",
        accession: ACC,
        form: "10-K",
        filed: "2026-02-01",
        periodOfReport: "2025-12-31",
        url: null,
      },
      [
        { item: "7", text: mdna },
        { item: "1A", text: risk },
      ],
      { maxTokens: 20, overlapTokens: 0 },
    );
    expect(n).toBeGreaterThanOrEqual(4);

    const hits = await hybridSearch(db, embedder, { query: "supply chain disruptions", cik: CIK, k: 3 });
    expect(hits[0]?.section).toBe("1A");
    expect(hits[0]?.text).toContain("Supply chain");
    expect(risk.slice(hits[0]?.charStart, hits[0]?.charEnd)).toBe(hits[0]?.text);
    expect(hits[0]?.textRank).toBe(1);

    // Re-indexing is idempotent.
    const again = await indexFiling(
      db,
      embedder,
      {
        cik: CIK,
        ticker: "TEST",
        companyName: "Test Corp",
        accession: ACC,
        form: "10-K",
        filed: "2026-02-01",
        periodOfReport: "2025-12-31",
        url: null,
      },
      [{ item: "7", text: mdna }],
      { maxTokens: 20, overlapTokens: 0 },
    );
    const rows = await db.select({ id: chunks.id }).from(chunks).where(eq(chunks.accession, ACC));
    expect(rows).toHaveLength(again);
  });
});
