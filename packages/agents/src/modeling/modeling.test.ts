import { fakeLlm } from "@dealpilot/llm";
import { describe, expect, test } from "vitest";
import { gatherHistory } from "../research/history.ts";
import { company, fakeEdgar, fakeMarket, fakeModel } from "../testkit.ts";
import {
  type AssumptionSet,
  assumptionSetSchema,
  baselineAssumptions,
  buildSnapshot,
  computePanel,
  EXPLICIT_YEARS,
  expandAssumptions,
  HORIZON_YEARS,
  mergeOverrides,
  NO_OVERRIDES,
  proposeAssumptions,
  recompute,
  runValuation,
  summarizeHistory,
  UnsupportedCompanyError,
  ValuationError,
} from "./index.ts";

/** Independent re-implementation of the 5-year Gordon DCF, used only to cross-check the pipeline. */
function referenceDcf(i: {
  revenue0: number;
  growth: number[];
  margin: number[];
  tax: number;
  da: number;
  capex: number;
  nwc: number;
  wacc: number;
  g: number;
  debt: number;
  cash: number;
  shares: number;
}) {
  let rev = i.revenue0;
  let pv = 0;
  let lastFcf = 0;
  i.growth.forEach((gr, k) => {
    const prev = rev;
    rev = prev * (1 + gr);
    const ebit = rev * (i.margin[k] as number);
    const fcf = ebit * (1 - i.tax) + rev * i.da - rev * i.capex - i.nwc * (rev - prev);
    pv += fcf / (1 + i.wacc) ** (k + 1);
    lastFcf = fcf;
  });
  const tv = (lastFcf * (1 + i.g)) / (i.wacc - i.g);
  const ev = pv + tv / (1 + i.wacc) ** i.growth.length;
  return { ev, perShare: (ev - i.debt + i.cash) / i.shares };
}

const edgar = () =>
  fakeEdgar([
    company("TESTCO"),
    company("PEERA", { scale: 5, margin: 0.2 }),
    company("PEERB", { scale: 3, margin: 0.3 }),
  ]);
const market = () =>
  fakeMarket({
    quotes: {
      TESTCO: { price: 20, marketCap: 2_000_000_000 },
      PEERA: { price: 50, marketCap: 9_000_000_000 },
      PEERB: { price: 30, marketCap: 6_000_000_000 },
    },
    beta: 1.2,
    riskFree: 0.04,
    peers: ["PEERA", "PEERB", "FOREIGN.X"],
  });

describe("history summary + baseline", () => {
  test("ratios come from the filings; baseline fades growth to the terminal rate", async () => {
    const h = await gatherHistory(edgar().client, "TESTCO");
    const s = summarizeHistory(h);
    expect(s.rows[0]?.ebitMargin).toBeCloseTo(0.25, 9);
    expect(s.rows[0]?.growth).toBeCloseTo(0.1, 9);
    expect(s.rows[0]?.daPct).toBeCloseTo(0.03, 9);
    expect(s.rows[0]?.taxRate).toBeCloseTo(0.25, 9);
    expect(s.totalDebt).toBe(200_000_000);
    expect(s.cashAndInvestments).toBe(300_000_000);
    // (AR 10% + inventory 5% − AP 9%) of revenue
    expect(s.nwcRatio).toBeCloseTo(0.06, 9);

    const b = baselineAssumptions(s, 0.04);
    expect(b.revenueGrowth).toHaveLength(HORIZON_YEARS);
    expect(b.revenueGrowth[0]).toBeCloseTo(0.1, 6); // 3y CAGR of a 10% grower
    expect(b.revenueGrowth[HORIZON_YEARS - 1]).toBeCloseTo(b.terminalGrowth, 12);
    expect(b.terminalGrowth).toBeCloseTo(0.025, 12);
    expect(b.ebitMargin.every((m) => Math.abs(m - 0.25) < 1e-9)).toBe(true);
  });

  test("a company with negative operating margin is rejected with a clear error", async () => {
    const loss = company("LOSS", { margin: -0.1 });
    const h = await gatherHistory(fakeEdgar([loss]).client, "LOSS");
    expect(() => baselineAssumptions(summarizeHistory(h), 0.04)).toThrow(UnsupportedCompanyError);
  });
});

describe("assumption proposals", () => {
  test("schema rejects growth far from the baseline and a terminal growth above final-year growth", async () => {
    const s = summarizeHistory(await gatherHistory(edgar().client, "TESTCO"));
    const base = baselineAssumptions(s, 0.04);
    const schema = assumptionSetSchema(base);
    // The model proposes years 1–5 only; code fades years 6–10.
    const view = {
      ...base,
      revenueGrowth: base.revenueGrowth.slice(0, EXPLICIT_YEARS),
      ebitMargin: base.ebitMargin.slice(0, EXPLICIT_YEARS),
    };
    expect(schema.safeParse(view).success).toBe(true);
    expect(schema.safeParse(base).success).toBe(false); // a full 10-year array is the wrong shape
    expect(schema.safeParse({ ...view, revenueGrowth: view.revenueGrowth.map((g) => g + 0.2) }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ ...view, terminalGrowth: 0.035, revenueGrowth: [0.1, 0.09, 0.08, 0.07, 0.02] })
        .success,
    ).toBe(false);
  });

  test("falls back to the baseline (and says so) when the model fails", async () => {
    const s = summarizeHistory(await gatherHistory(edgar().client, "TESTCO"));
    const base = baselineAssumptions(s, 0.04);
    const { client } = fakeLlm(() => ({ nonsense: true }));
    const r = await proposeAssumptions({
      llm: client,
      summary: s,
      baseline: base,
      sector: null,
      industry: null,
      riskFreeRate: 0.04,
    });
    expect(r.usedFallback).toBe(true);
    expect(r.assumptions).toEqual(base);
    expect(r.note).toMatch(/baseline/);
  });
});

describe("runValuation", () => {
  const a: AssumptionSet = expandAssumptions({
    revenueGrowth: [0.1, 0.09, 0.08, 0.06, 0.04],
    ebitMargin: [0.25, 0.25, 0.26, 0.26, 0.27],
    taxRate: 0.25,
    daPctRevenue: 0.03,
    capexPctRevenue: 0.04,
    nwcPctOfRevenueChange: 0.06,
    terminalGrowth: 0.025,
    equityRiskPremium: 0.05,
    preTaxCostOfDebt: 0.05,
    rationale: { growth: "", margins: "", other: "" },
  });

  async function summary() {
    return summarizeHistory(await gatherHistory(edgar().client, "TESTCO"));
  }

  test("matches an independent hand calculation (WACC override)", async () => {
    const s = await summary();
    const v = runValuation({
      summary: s,
      market: { price: 20, marketCap: 2e9, beta: 1.2, riskFreeRate: 0.04 },
      assumptions: a,
      waccOverride: 0.09,
    });
    const ref = referenceDcf({
      revenue0: s.latestRevenue,
      growth: a.revenueGrowth,
      margin: a.ebitMargin,
      tax: a.taxRate,
      da: a.daPctRevenue,
      capex: a.capexPctRevenue,
      nwc: a.nwcPctOfRevenueChange,
      wacc: 0.09,
      g: a.terminalGrowth,
      debt: s.totalDebt,
      cash: s.cashAndInvestments,
      shares: s.dilutedShares,
    });
    expect(v.enterpriseValue).toBeCloseTo(ref.ev, 3);
    expect(v.perShare).toBeCloseTo(ref.perShare, 9);
    expect(v.waccSource).toBe("override");
  });

  test("computed WACC follows CAPM with market-value weights", async () => {
    const s = await summary();
    const v = runValuation({
      summary: s,
      market: { price: 20, marketCap: 2e9, beta: 1.2, riskFreeRate: 0.04 },
      assumptions: a,
    });
    const ke = 0.04 + 1.2 * 0.05; // 10.0%
    const kd = 0.05 * (1 - 0.25);
    const w = (2e9 * ke + s.totalDebt * kd) / (2e9 + s.totalDebt);
    expect(v.costOfEquity).toBeCloseTo(ke, 12);
    expect(v.wacc).toBeCloseTo(w, 12);
  });

  test("sensitivity grid is centred on the base case and monotone in WACC", async () => {
    const s = await summary();
    const v = runValuation({
      summary: s,
      market: { price: 20, marketCap: 2e9, beta: 1.2, riskFreeRate: 0.04 },
      assumptions: a,
    });
    const mid = v.sensitivity.values[2]?.[2];
    expect(mid).toBeCloseTo(v.perShare, 9);
    for (let c = 0; c < 5; c++) {
      for (let r = 1; r < 5; r++) {
        expect(v.sensitivity.values[r]?.[c] as number).toBeLessThan(
          v.sensitivity.values[r - 1]?.[c] as number,
        );
      }
    }
  });

  test("rejects WACC at or below terminal growth, and non-positive final-year cash flow", async () => {
    const s = await summary();
    const m = { price: 20, marketCap: 2e9, beta: 1.2, riskFreeRate: 0.04 };
    expect(() => runValuation({ summary: s, market: m, assumptions: a, waccOverride: 0.025 })).toThrow(
      ValuationError,
    );
    expect(() =>
      runValuation({
        summary: s,
        market: m,
        assumptions: { ...a, ebitMargin: a.ebitMargin.map(() => 0), capexPctRevenue: 0.2 },
        waccOverride: 0.09,
      }),
    ).toThrow(/free cash flow/);
  });
});

describe("snapshot, panel and recompute", () => {
  const model = () =>
    fakeModel({
      routes: [],
      peers: ["PEERA", "NOPE", "PEERB"],
    });

  test("builds a cited panel; peers that cannot be loaded are skipped and noted", async () => {
    const e = edgar();
    const snap = await buildSnapshot(
      { llm: model().client, edgar: e.client, market: market(), now: () => new Date("2026-11-21T00:00:00Z") },
      "TESTCO",
    );
    expect(snap.peers.map((p) => p.data.ticker)).toEqual(["PEERA", "PEERB"]);
    expect(snap.notes.join(" ")).toMatch(/NOPE/);
    const panel = computePanel(snap);
    expect(panel.valuation.perShare).toBeGreaterThan(0);
    expect(panel.comps.peers).toHaveLength(2);
    expect(panel.comps.impliedPerShare).not.toBeNull();
    // every assumption that cites evidence points at evidence that exists in the panel
    for (const a of panel.assumptions) if (a.evidenceId) expect(panel.evidence[a.evidenceId]).toBeDefined();
    expect(panel.assumptions.find((a) => a.key === "diluted_shares")?.source).toBe("filing");
    expect(panel.assumptions.find((a) => a.key === "price")?.source).toBe("market");
    expect(panel.formulaIds).toContain("dcf.valuation");
  });

  test("recompute applies overrides with no network and no model calls", async () => {
    const e = edgar();
    const m = market();
    const mdl = model();
    const snap = await buildSnapshot({ llm: mdl.client, edgar: e.client, market: m }, "TESTCO");
    const factsBefore = e.calls.facts;
    const quotesBefore = m.calls.quote;
    const llmBefore = mdl.calls.length;

    const r1 = recompute(snap, { ...NO_OVERRIDES, wacc: 0.08 });
    const r2 = recompute(r1.snapshot, { ...NO_OVERRIDES, terminalGrowth: 0.03, excludePeers: ["peera"] });
    expect(r1.panel.valuation.wacc).toBe(0.08);
    expect(r2.panel.valuation.wacc).toBe(0.08); // earlier override persists
    expect(r2.panel.valuation.terminalGrowth).toBe(0.03);
    expect(r2.panel.comps.peers.find((p) => p.ticker === "PEERA")?.included).toBe(false);
    expect(r2.panel.valuation.perShare).toBeGreaterThan(r1.panel.valuation.perShare); // higher g → higher value
    expect(e.calls.facts).toBe(factsBefore);
    expect(m.calls.quote).toBe(quotesBefore);
    expect(mdl.calls.length).toBe(llmBefore);
  });

  test("a growth shift raises value; a margin cut lowers it", async () => {
    const snap = await buildSnapshot(
      { llm: model().client, edgar: edgar().client, market: market() },
      "TESTCO",
    );
    const base = computePanel(snap).valuation.perShare;
    expect(
      recompute(snap, { ...NO_OVERRIDES, revenueGrowthShift: 0.03 }).panel.valuation.perShare,
    ).toBeGreaterThan(base);
    expect(
      recompute(snap, { ...NO_OVERRIDES, ebitMarginShift: -0.05 }).panel.valuation.perShare,
    ).toBeLessThan(base);
  });

  test("mergeOverrides: later values win and exclusions accumulate (case-insensitive, de-duplicated)", () => {
    const m = mergeOverrides(
      { ...NO_OVERRIDES, wacc: 0.09, excludePeers: ["DELL"] },
      { ...NO_OVERRIDES, wacc: 0.1, excludePeers: ["dell", "HPQ"] },
    );
    expect(m.wacc).toBe(0.1);
    expect(m.excludePeers).toEqual(["DELL", "HPQ"]);
  });

  test("missing beta falls back to 1.0 with a note", async () => {
    const mkt = fakeMarket({
      quotes: { TESTCO: { price: 20, marketCap: 2e9 } },
      beta: null,
      riskFree: 0.04,
      peers: [],
    });
    const snap = await buildSnapshot(
      { llm: fakeModel({ routes: [], peers: [] }).client, edgar: edgar().client, market: mkt },
      "TESTCO",
    );
    expect(snap.market.beta).toBe(1);
    expect(snap.notes.join(" ")).toMatch(/Beta not available/);
  });
});

describe("10-year horizon", () => {
  const five = {
    revenueGrowth: [0.12, 0.11, 0.1, 0.09, 0.08],
    ebitMargin: [0.3, 0.3, 0.3, 0.3, 0.3],
    terminalGrowth: 0.025,
  };

  test("code fades years 6–10 linearly from the year-5 rate to terminal growth; margins hold", () => {
    const e = expandAssumptions(five);
    expect(e.revenueGrowth).toHaveLength(HORIZON_YEARS);
    expect(e.revenueGrowth.slice(0, EXPLICIT_YEARS)).toEqual(five.revenueGrowth); // the model's years are untouched
    // 8.0% → 2.5% over 5 more steps: 6.9%, 5.8%, 4.7%, 3.6%, 2.5%
    [0.069, 0.058, 0.047, 0.036, 0.025].forEach((x, k) => {
      expect(e.revenueGrowth[EXPLICIT_YEARS + k]).toBeCloseTo(x, 12);
    });
    expect(e.ebitMargin.slice(EXPLICIT_YEARS).every((m) => m === 0.3)).toBe(true);
  });

  test("the final forecast year grows at the terminal rate, so the Gordon step has no growth cliff", () => {
    const e = expandAssumptions(five);
    expect(e.revenueGrowth.at(-1)).toBeCloseTo(five.terminalGrowth, 12);
  });

  test("matches an independent hand calculation over 10 years", async () => {
    const s = summarizeHistory(await gatherHistory(edgar().client, "TESTCO"));
    const e = expandAssumptions({
      ...five,
      taxRate: 0.25,
      daPctRevenue: 0.03,
      capexPctRevenue: 0.04,
      nwcPctOfRevenueChange: 0.06,
      equityRiskPremium: 0.05,
      preTaxCostOfDebt: 0.05,
      rationale: { growth: "", margins: "", other: "" },
    });
    const v = runValuation({
      summary: s,
      market: { price: 20, marketCap: 2e9, beta: 1.2, riskFreeRate: 0.04 },
      assumptions: e,
      waccOverride: 0.09,
    });
    const ref = referenceDcf({
      revenue0: s.latestRevenue,
      growth: e.revenueGrowth,
      margin: e.ebitMargin,
      tax: 0.25,
      da: 0.03,
      capex: 0.04,
      nwc: 0.06,
      wacc: 0.09,
      g: 0.025,
      debt: s.totalDebt,
      cash: s.cashAndInvestments,
      shares: s.dilutedShares,
    });
    expect(v.projection).toHaveLength(10);
    expect(v.enterpriseValue).toBeCloseTo(ref.ev, 3);
    expect(v.perShare).toBeCloseTo(ref.perShare, 9);
  });

  test("a high-growth company is worth more over 10 years than when forced to terminal growth after 5", async () => {
    const s = summarizeHistory(await gatherHistory(edgar().client, "TESTCO"));
    const base = {
      taxRate: 0.25,
      daPctRevenue: 0.03,
      capexPctRevenue: 0.04,
      nwcPctOfRevenueChange: 0.06,
      equityRiskPremium: 0.05,
      preTaxCostOfDebt: 0.05,
      rationale: { growth: "", margins: "", other: "" },
    };
    const market = { price: 20, marketCap: 2e9, beta: 1.2, riskFreeRate: 0.04 };
    const tenYear = runValuation({
      summary: s,
      market,
      assumptions: expandAssumptions({ ...five, ...base }),
      waccOverride: 0.09,
    });
    // Old behaviour: only 5 explicit years, then straight to the terminal rate.
    const fiveYear = runValuation({
      summary: s,
      market,
      assumptions: { ...five, ...base },
      waccOverride: 0.09,
    });
    expect(tenYear.perShare).toBeGreaterThan(fiveYear.perShare);
    // A company already at terminal growth gains nothing from the extra years' growth.
    const flat = {
      revenueGrowth: [0.025, 0.025, 0.025, 0.025, 0.025],
      ebitMargin: [0.3, 0.3, 0.3, 0.3, 0.3],
      terminalGrowth: 0.025,
    };
    const a10 = runValuation({
      summary: s,
      market,
      assumptions: expandAssumptions({ ...flat, ...base }),
      waccOverride: 0.09,
    }).perShare;
    const a5 = runValuation({
      summary: s,
      market,
      assumptions: { ...flat, ...base },
      waccOverride: 0.09,
    }).perShare;
    expect(a10).toBeCloseTo(a5, 6);
  });

  test("the baseline fade runs to terminal growth in year 10 and the panel shows 10 projected years", async () => {
    const snap = await buildSnapshot(
      { llm: fakeModel({ routes: [], peers: [] }).client, edgar: edgar().client, market: market() },
      "TESTCO",
    );
    const panel = computePanel(snap);
    expect(panel.projection).toHaveLength(10);
    expect(panel.projection.at(-1)?.year).toBe(2036);
    expect(panel.assumptions.filter((x) => x.key.startsWith("revenue_growth_y"))).toHaveLength(10);
    expect(snap.assumptions.revenueGrowth.at(-1)).toBeCloseTo(snap.assumptions.terminalGrowth, 12);
  });
});
