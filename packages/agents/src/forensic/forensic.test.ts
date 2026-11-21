import { chunks, companies, createDb, type Db, eq, filings } from "@dealpilot/db";
import { fakeLlm } from "@dealpilot/llm";
import { fakeEmbedder, indexFiling } from "@dealpilot/sources";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildHistory } from "./fixtures.ts";
import { runForensic } from "./index.ts";
import { runForensicText } from "./text.ts";

const url = process.env.TEST_DATABASE_URL;
const CIK = "0009999991";
const EMPTY_CIK = "0009999990";
const ACC = "0009999991-26-000001";

describe("runForensic (offline)", () => {
  const ctx = { cik: "0001234567", companyName: "Acme Corp" };

  test("rules only: sorted by severity then id; deps untouched without withText", async () => {
    const history = buildHistory({
      series: {
        receivables: [130, 100, 93, 87, 81], // high receivables + medium dso
        basicShares: [105, 100, 100, 100, 100], // low dilution
      },
    });
    const { client, calls } = fakeLlm(() => ({ disclosures: [] }));
    const out = await runForensic(
      { llm: client, db: {} as Db, embedder: fakeEmbedder() },
      { ...ctx, history },
    );
    expect(out.map((f) => f.basis)).toEqual(["receivables", "dso", "dilution"]);
    expect(out.map((f) => f.severity)).toEqual(["high", "medium", "low"]);
    expect(calls).toHaveLength(0);
    expect(await runForensic(undefined, { ...ctx, history })).toEqual(out);
  });

  test("a failing text stage is swallowed and reported as one low-severity finding", async () => {
    const { client } = fakeLlm(() => ({ disclosures: [] }));
    const out = await runForensic(
      { llm: client, db: {} as Db, embedder: fakeEmbedder() }, // a db stub that throws on use
      { ...ctx, history: buildHistory(), withText: true },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "forensic:text:unavailable",
      severity: "low",
      title: "Filing-text review unavailable",
      evidenceIds: [],
    });
  });
});

const text =
  "Management identified a material weakness in internal control over financial reporting related to revenue recognition controls.\n\n" +
  "Our largest customer accounted for a significant portion of net sales during the year.";

describe.skipIf(!url)("runForensicText guards (postgres)", { timeout: 60_000 }, () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  const embedder = fakeEmbedder();

  afterAll(async () => {
    await db.delete(chunks).where(eq(chunks.accession, ACC));
    await db.delete(filings).where(eq(filings.accession, ACC));
    await db.delete(companies).where(eq(companies.cik, CIK));
    await close();
  });

  let seeded: Awaited<ReturnType<typeof seedRows>>;
  beforeAll(async () => {
    seeded = await seedRows();
  }, 60_000);
  const seed = async () => seeded;

  async function seedRows() {
    await indexFiling(
      db,
      embedder,
      {
        cik: CIK,
        ticker: "TSTF",
        companyName: "Testf Inc",
        accession: ACC,
        form: "10-K",
        filed: "2026-11-01",
        periodOfReport: "2026-09-30",
        url: null,
      },
      [{ item: "9A", text }],
      { maxTokens: 25, overlapTokens: 0 },
    );
    const rows = await db.select().from(chunks).where(eq(chunks.accession, ACC));
    return rows.find((r) => r.text.includes("material weakness")) as (typeof rows)[number];
  }
  const run = (llm: ReturnType<typeof fakeLlm>["client"]) =>
    runForensicText({ llm, db, embedder }, { cik: CIK, companyName: "Testf Inc" });
  const quote = "a material weakness in internal control over financial reporting";

  test("a verbatim quote is kept, with filing evidence ids", async () => {
    const c = await seed();
    const out = await run(
      fakeLlm(() => ({
        disclosures: [
          {
            topic: "material_weakness",
            chunkId: c.id,
            quote,
            detail: "Management disclosed a weakness in controls over revenue recognition.",
          },
        ],
      })).client,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: `forensic:text:material_weakness:${ACC}`,
      agent: "forensic",
      severity: "high",
      basis: "text:material_weakness",
    });
    expect(out[0]?.evidenceIds[0]).toMatch(new RegExp(`^filing:${ACC}:item9A:\\d+$`));
  });

  test("a made-up quote, or an unknown chunk id, is dropped", async () => {
    const c = await seed();
    const out = await run(
      fakeLlm(() => ({
        disclosures: [
          {
            topic: "material_weakness",
            chunkId: c.id,
            quote: "the auditor resigned after a dispute over revenue",
            detail: "Fabricated disclosure.",
          },
          { topic: "going_concern", chunkId: "00000000-0000-0000-0000-000000000000", quote, detail: "Nope." },
        ],
      })).client,
    );
    expect(out).toEqual([]);
  });

  test("a digit in the model's detail is rejected", async () => {
    const c = await seed();
    await expect(
      run(
        fakeLlm(() => ({
          disclosures: [
            { topic: "material_weakness", chunkId: c.id, quote, detail: "Control failures cost 40 million." },
          ],
        })).client,
      ),
    ).rejects.toThrow(/digits/);
  });

  test("no indexed chunks: returns [] without calling the model", async () => {
    const { client, calls } = fakeLlm(() => ({ disclosures: [] }));
    const out = await runForensicText(
      { llm: client, db, embedder },
      { cik: EMPTY_CIK, companyName: "Nobody" },
    );
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
