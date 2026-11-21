import { fakeLlm } from "@dealpilot/llm";
import { industryBetaTable } from "@dealpilot/market";
import { describe, expect, test } from "vitest";
import { company, fakeEdgar, fakeMarket, fakeModel } from "../testkit.ts";
import { industryBeta, selectIndustry } from "./beta.ts";
import { buildSnapshot, computePanel } from "./index.ts";

/** A valid table (the schema requires ≥ 50 industries) with a few named, hand-checkable entries. */
const table = industryBetaTable({
  source: "https://pages.stern.nyu.edu/~adamodar/pc/datasets/betas.xls",
  dataset: "test",
  updated: "2026-01-05",
  note: "test",
  industries: [
    {
      name: "Software (System & Application)",
      firms: 300,
      beta: 1.2,
      debtToEquity: 0.1,
      effectiveTaxRate: 0.1,
      unleveredBeta: 1.1,
      unleveredBetaCorrectedForCash: 1.2,
    },
    {
      name: "Retail (General)",
      firms: 20,
      beta: 1.0,
      debtToEquity: 0.4,
      effectiveTaxRate: 0.2,
      unleveredBeta: 0.8,
      unleveredBetaCorrectedForCash: 0.85,
    },
    ...Array.from({ length: 50 }, (_, k) => ({
      name: `Filler ${k}`,
      firms: 5,
      beta: 1,
      debtToEquity: 0.2,
      effectiveTaxRate: 0.1,
      unleveredBeta: 0.9,
      unleveredBetaCorrectedForCash: 0.95,
    })),
  ],
});

describe("industryBeta", () => {
  test("relevers the cash-corrected unlevered beta: 1.2 × (1 + (1 − 0.25) × D/E)", () => {
    // debt 200, market cap 1000 → D/E 0.2 → 1.2 × (1 + 0.75 × 0.2) = 1.2 × 1.15 = 1.38
    const r = industryBeta(table, "software (system & application)", {
      totalDebt: 200,
      marketCap: 1000,
      taxRate: 0.25,
    });
    expect(r.debtToEquity).toBeCloseTo(0.2, 12);
    expect(r.beta).toBeCloseTo(1.38, 12);
    expect(r.industry).toBe("Software (System & Application)");
    expect(r.basis).toMatch(/Damodaran industry beta .*2026-01-05.*unlevered 1\.20.*D\/E 0\.20/);
  });
  test("a debt-free company keeps the unlevered beta; an unknown industry is an error", () => {
    expect(
      industryBeta(table, "Retail (General)", { totalDebt: 0, marketCap: 500, taxRate: 0.2 }).beta,
    ).toBeCloseTo(0.85, 12);
    expect(() => industryBeta(table, "Nope", { totalDebt: 0, marketCap: 500, taxRate: 0.2 })).toThrow(
      /Unknown Damodaran industry/,
    );
  });
});

describe("selectIndustry", () => {
  test("accepts only a name from the list (case-insensitive) and returns the canonical spelling", async () => {
    const ok = fakeLlm(() => ({ industry: "retail (general)", rationale: "Sells goods to consumers." }));
    expect(
      (await selectIndustry(ok.client, table, { name: "X", sector: null, industry: null })).industry,
    ).toBe("Retail (General)");
    const bad = fakeLlm(() => ({ industry: "Consumer Electronics", rationale: "Not on the list." }));
    await expect(
      selectIndustry(bad.client, table, { name: "X", sector: null, industry: null }),
    ).rejects.toThrow();
  });
});

describe("beta in the snapshot and panel", () => {
  const mkt = () =>
    fakeMarket({ quotes: { TESTCO: { price: 20, marketCap: 2e9 } }, beta: 1.2, riskFree: 0.04, peers: [] });

  test("the industry beta replaces the provider beta, is labelled, and is cited in the panel", async () => {
    const snap = await buildSnapshot(
      {
        llm: fakeModel({ routes: [], peers: [], industry: "Software (System & Application)" }).client,
        edgar: fakeEdgar([company("TESTCO")]).client,
        market: mkt(),
        industryBetas: table,
      },
      "TESTCO",
    );
    // debt 200m / market cap 2bn = 0.1; baseline tax 25% (filings) → 1.2 × (1 + 0.75 × 0.1) = 1.29
    expect(snap.market.beta).toBeCloseTo(1.29, 9);
    expect(snap.market.betaBasis).toMatch(/^Damodaran industry beta/);
    const panel = computePanel(snap);
    const row = panel.assumptions.find((a) => a.key === "beta");
    expect(row?.value).toBeCloseTo(1.29, 9);
    expect(row?.rationale).toMatch(/Damodaran industry beta/);
    expect(row?.evidenceId && panel.evidence[row.evidenceId]?.section).toBe("damodaran:industry-betas");
  });

  test("if industry selection fails the provider beta is used, with a note", async () => {
    const llm = fakeModel({ routes: [], peers: [], industry: "Not a real industry" });
    const snap = await buildSnapshot(
      { llm: llm.client, edgar: fakeEdgar([company("TESTCO")]).client, market: mkt(), industryBetas: table },
      "TESTCO",
    );
    expect(snap.market.beta).toBe(1.2);
    expect(snap.market.betaBasis).toBe("Company beta from the market data provider");
    expect(snap.notes.join(" ")).toMatch(/Industry beta unavailable[\s\S]*provider.s company beta/);
  });

  test("a user beta override still wins and is labelled", async () => {
    const snap = await buildSnapshot(
      {
        llm: fakeModel({ routes: [], peers: [], industry: "Retail (General)" }).client,
        edgar: fakeEdgar([company("TESTCO")]).client,
        market: mkt(),
        industryBetas: table,
      },
      "TESTCO",
    );
    const panel = computePanel({ ...snap, overrides: { ...snap.overrides, beta: 0.9 } });
    const row = panel.assumptions.find((a) => a.key === "beta");
    expect(row).toMatchObject({ value: 0.9, source: "assumption", rationale: "User override" });
  });
});
