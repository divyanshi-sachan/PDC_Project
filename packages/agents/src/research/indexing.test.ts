import { chunks, companies, createDb, eq, filings } from "@dealpilot/db";
import { type EdgarClient, fakeEmbedder } from "@dealpilot/sources";
import { afterAll, describe, expect, test } from "vitest";
import { indexLatestTenK } from "./indexing.ts";

const url = process.env.TEST_DATABASE_URL;
const CIK = "0009999998";
const ACC = "0009999998-26-000001";

function fakeEdgar(): EdgarClient & { sectionCalls: number } {
  const c = {
    sectionCalls: 0,
    filings: async () => [
      {
        accession: ACC,
        form: "10-K",
        filed: "2026-02-01",
        period_of_report: "2025-12-31",
        primary_document_url: "https://x/y",
      },
    ],
    company: async () => ({
      cik: CIK,
      ticker: "TSTX",
      name: "Test Co",
      sic: null,
      sic_description: null,
      fiscal_year_end: "1231",
      exchanges: [],
    }),
    sections: async () => {
      c.sectionCalls++;
      return [
        {
          accession: ACC,
          item: "7",
          title: "MD&A",
          text: "Revenue grew strongly.\n\nMargins expanded on mix.",
          url: "https://x/y",
        },
      ];
    },
  };
  return c as unknown as EdgarClient & { sectionCalls: number };
}

describe.skipIf(!url)("indexLatestTenK (postgres)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  afterAll(async () => {
    await db.delete(chunks).where(eq(chunks.accession, ACC));
    await db.delete(filings).where(eq(filings.accession, ACC));
    await db.delete(companies).where(eq(companies.cik, CIK));
    await close();
  });

  test("indexes once, then reuses", async () => {
    const edgar = fakeEdgar();
    const deps = { edgar, db, embedder: fakeEmbedder() };
    const first = await indexLatestTenK(deps, "TSTX");
    expect(first.reused).toBe(false);
    expect(first.chunks).toBeGreaterThan(0);
    const second = await indexLatestTenK(deps, "TSTX");
    expect(second).toEqual({ accession: ACC, chunks: first.chunks, reused: true });
    expect(edgar.sectionCalls).toBe(1);
  });
});
