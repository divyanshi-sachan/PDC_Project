import { chunks, companies, createDb, eq, filings } from "@dealpilot/db";
import { fakeLlm } from "@dealpilot/llm";
import { fakeEmbedder, indexFiling } from "@dealpilot/sources";
import { afterAll, describe, expect, test } from "vitest";
import { answerFromFilings } from "./answer.ts";
import { buildSnapshot, computePanel, NO_OVERRIDES } from "./modeling/index.ts";
import { type Route, routeMessage } from "./orchestrator.ts";
import { formatAnalysisMessage, writeCommentary } from "./respond.ts";
import { company, fakeEdgar, fakeMarket, fakeModel } from "./testkit.ts";

describe("routeMessage", () => {
  const route = async (out: Record<string, unknown>, active: string | null = null): Promise<Route> => {
    const { client } = fakeLlm(() => ({ ticker: null, changes: null, question: null, reply: null, ...out }));
    return routeMessage({ llm: client, message: "x", history: [], activeTicker: active });
  };

  test("analysis needs a valid ticker; lowercase is normalised; junk becomes a clarification", async () => {
    expect(await route({ type: "analysis", ticker: " aapl " })).toEqual({
      type: "analysis",
      ticker: "AAPL",
      price: null,
    });
    const bad = await route({ type: "analysis", ticker: "not a ticker!" });
    expect(bad.type).toBe("other");
    const none = await route({ type: "analysis", ticker: null });
    expect(none.type).toBe("other");
  });

  test("recompute without an active analysis is redirected; with one it carries the overrides", async () => {
    expect((await route({ type: "recompute", changes: { wacc: 0.09 } })).type).toBe("other");
    const r = await route({ type: "recompute", changes: { wacc: 0.09 } }, "AAPL");
    expect(r).toMatchObject({ type: "recompute", changes: { ...NO_OVERRIDES, wacc: 0.09 } });
  });

  test("an evidence question falls back to the active ticker", async () => {
    const r = await route(
      { type: "evidence_question", ticker: null, question: "What are the risks?" },
      "MSFT",
    );
    expect(r).toEqual({ type: "evidence_question", ticker: "MSFT", question: "What are the risks?" });
    expect((await route({ type: "evidence_question", ticker: null, question: "q" })).type).toBe("other");
  });

  test("the router rejects out-of-range overrides (a 50% WACC is not accepted)", async () => {
    const { client } = fakeLlm(() => ({
      type: "recompute",
      ticker: null,
      question: null,
      reply: null,
      changes: { wacc: 0.5 },
    }));
    await expect(
      routeMessage({ llm: client, message: "x", history: [], activeTicker: "AAPL" }),
    ).rejects.toThrow();
  });
});

describe("commentary guard", () => {
  async function panel() {
    const snap = await buildSnapshot(
      {
        llm: fakeModel({ routes: [], peers: [] }).client,
        edgar: fakeEdgar([company("TESTCO")]).client,
        market: fakeMarket({ quotes: { TESTCO: { price: 20, marketCap: 2e9 } }, peers: [] }),
      },
      "TESTCO",
    );
    return computePanel(snap);
  }

  test("digits in the model's commentary are rejected, so it is dropped", async () => {
    const p = await panel();
    expect(
      await writeCommentary(
        fakeLlm(() => ({ commentary: "Value is 42% above the market, driven by growth of 8%." })).client,
        p,
      ),
    ).toBeNull();
    expect(
      await writeCommentary(
        fakeLlm(() => ({
          commentary: "The valuation depends mainly on long-run growth and margins, so verify those inputs.",
        })).client,
        p,
      ),
    ).toMatch(/long-run growth/);
  });

  test("the factual message is formatted from the computed panel only", async () => {
    const p = await panel();
    const { text, citations } = formatAnalysisMessage(p, ["WACC = 9%"]);
    expect(text).toContain(`$${p.valuation.perShare.toFixed(2)} per share`);
    expect(text).toContain("Applied: WACC = 9%.");
    expect(text).toMatch(/Trading comps: not enough comparable data/);
    expect(citations.map((c) => c.label)).toContain("Share price (market data)");
    for (const c of citations) expect(p.evidence[c.evidenceId]).toBeDefined();
  });
});

const url = process.env.TEST_DATABASE_URL;
const CIK = "0009999996";
const ACC = "0009999996-26-000007";

describe.skipIf(!url)("answerFromFilings guards (postgres)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  const embedder = fakeEmbedder();
  const risk =
    "We depend on a single supplier for advanced chips and any disruption could harm results.\n\n" +
    "Sales outside the United States were 58 percent of net sales in the latest fiscal year.";

  afterAll(async () => {
    await db.delete(chunks).where(eq(chunks.accession, ACC));
    await db.delete(filings).where(eq(filings.accession, ACC));
    await db.delete(companies).where(eq(companies.cik, CIK));
    await close();
  });

  async function seed() {
    await indexFiling(
      db,
      embedder,
      {
        cik: CIK,
        ticker: "TSTX",
        companyName: "Testx Inc",
        accession: ACC,
        form: "10-K",
        filed: "2026-11-01",
        periodOfReport: "2026-09-30",
        url: null,
      },
      [{ item: "1A", text: risk }],
      { maxTokens: 25, overlapTokens: 0 },
    );
    const rows = await db.select().from(chunks).where(eq(chunks.accession, ACC));
    return rows.find((r) => r.text.includes("single supplier")) as (typeof rows)[number];
  }
  const ask = (llm: ReturnType<typeof fakeLlm>["client"]) =>
    answerFromFilings(
      { llm, db, embedder },
      { cik: CIK, companyName: "Testx Inc", question: "single supplier chips disruption" },
    );

  test("a verbatim quote and numbers from the cited text are accepted, with a span into the filing", async () => {
    const c = await seed();
    const quote = "single supplier for advanced chips";
    const out = await ask(
      fakeLlm(() => ({
        answer: "The company relies on a single supplier for advanced chips.",
        citations: [{ chunkId: c.id, quote }],
      })).client,
    );
    expect(out.text).toMatch(/single supplier/);
    const ev = out.evidence[0];
    expect(ev?.kind).toBe("filing_text");
    expect(ev?.accession).toBe(ACC);
    expect(ev?.quote).toBe(quote);
    expect(risk.slice(ev?.span?.[0], ev?.span?.[1])).toBe(quote);
  });

  test("a number that is not in the cited text is rejected", async () => {
    const c = await seed();
    await expect(
      ask(
        fakeLlm(() => ({
          answer: "Foreign sales were 63 percent of the total.",
          citations: [{ chunkId: c.id, quote: "single supplier for advanced chips" }],
        })).client,
      ),
    ).rejects.toThrow(/63/);
  });

  test("a quote that is not verbatim, or a chunk id that was never retrieved, is rejected", async () => {
    const c = await seed();
    await expect(
      ask(
        fakeLlm(() => ({
          answer: "x ok.",
          citations: [{ chunkId: c.id, quote: "a paraphrased passage about suppliers" }],
        })).client,
      ),
    ).rejects.toThrow(/verbatim/);
    await expect(
      ask(
        fakeLlm(() => ({
          answer: "x ok.",
          citations: [
            { chunkId: "00000000-0000-0000-0000-000000000000", quote: "single supplier for advanced chips" },
          ],
        })).client,
      ),
    ).rejects.toThrow(/chunkId/);
  });
});
