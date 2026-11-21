import { describe, expect, test } from "vitest";
import type { HistoryItem } from "../research/types.ts";
import { buildHistory } from "./fixtures.ts";
import { forensicRules, RULES } from "./rules.ts";

const E0 = "2026-09-26";
type Series = Partial<Record<HistoryItem, number[]>>;
const run = (basis: string, series: Series = {}, restated: [HistoryItem, number][] = []) =>
  forensicRules(buildHistory({ series, restated })).filter((f) => f.basis === basis);
const one = (basis: string, series: Series = {}) => {
  const out = run(basis, series);
  expect(out).toHaveLength(1);
  return out[0] as NonNullable<(typeof out)[number]>;
};

describe("forensicRules", () => {
  test("a clean company yields no findings, and the result is deterministic", () => {
    const h = buildHistory();
    expect(forensicRules(h)).toEqual([]);
    expect(forensicRules(h)).toEqual(forensicRules(h));
  });

  test("every rule in the catalogue has a unique id", () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });

  test("accruals: (NI − CFO) / average total assets", () => {
    const flat = { totalAssets: [1000, 1000, 1000, 1000, 1000] };
    // avg assets 1000. (150 − 30) / 1000 = 0.12 → medium
    const m = one("accruals", {
      ...flat,
      netIncome: [150, 152, 141.6, 132, 123.2],
      operatingCashFlow: [30, 165, 150, 140, 130],
    });
    expect(m.severity).toBe("medium");
    expect(m.id).toBe(`forensic:accruals:${E0}`);
    expect(m.evidenceIds).toEqual([
      `xbrl:netIncome:${E0}`,
      `xbrl:operatingCashFlow:${E0}`,
      `xbrl:totalAssets:${E0}`,
      "xbrl:totalAssets:2025-09-27",
    ]);
    expect(m.detail).toContain("12.0% of average total assets");
    // (250 − 20) / 1000 = 0.23 → high
    expect(
      one("accruals", {
        ...flat,
        netIncome: [250, 152, 141.6, 132, 123.2],
        operatingCashFlow: [20, 165, 150, 140, 130],
      }).severity,
    ).toBe("high");
    // (150 − 49) / 1000 = 0.101 → just over → medium; (150 − 50) / 1000 = 0.1 → not above → none
    expect(
      run("accruals", { ...flat, netIncome: [150, 1, 1, 1, 1], operatingCashFlow: [49, 1, 1, 1, 1] }),
    ).toHaveLength(1);
    expect(
      run("accruals", { ...flat, netIncome: [150, 1, 1, 1, 1], operatingCashFlow: [50, 1, 1, 1, 1] }),
    ).toHaveLength(0);
  });

  test("cash conversion: weak OCF/NI in 2 of 3 years", () => {
    // NI 164, 152, 141.6. OCF 100/164 = 0.61 weak; 100/152 = 0.66 weak; 150/141.6 = 1.06 fine → 2 weak → medium
    const f = one("cash_conversion", { operatingCashFlow: [100, 100, 150, 140, 130] });
    expect(f.severity).toBe("medium");
    expect(f.evidenceIds).toHaveLength(6);
    // only one weak year (100/164 = 0.61; 160/152, 150/141.6 fine) → none
    expect(run("cash_conversion", { operatingCashFlow: [100, 160, 150, 140, 130] })).toHaveLength(0);
    // 115/164 = 0.701 is not below 0.7; 106/152 = 0.697 is → one weak → none
    expect(run("cash_conversion", { operatingCashFlow: [115, 106, 150, 140, 130] })).toHaveLength(0);
    // 114/164 = 0.695 weak and 106/152 = 0.697 weak → medium
    expect(run("cash_conversion", { operatingCashFlow: [114, 106, 150, 140, 130] })).toHaveLength(1);
  });

  test("negative OCF with positive net income is high, and replaces the medium cash-conversion flag", () => {
    const f = one("cash_negative_ocf", { operatingCashFlow: [-10, 100, 150, 140, 130] });
    expect(f.severity).toBe("high");
    expect(run("cash_conversion", { operatingCashFlow: [-10, 100, 150, 140, 130] })).toHaveLength(0);
    // loss-making with negative OCF is not "profitable on paper"
    expect(
      run("cash_negative_ocf", { netIncome: [-5, 1, 1, 1, 1], operatingCashFlow: [-10, 1, 1, 1, 1] }),
    ).toHaveLength(0);
  });

  test("receivables vs revenue: growth gap in points", () => {
    // receivables 130/100 − 1 = 30%; revenue 1080/1000 − 1 = 8% → gap 22 points → high
    const h = one("receivables", { receivables: [130, 100, 93, 87, 81] });
    expect(h.severity).toBe("high");
    expect(h.detail).toBe(
      "Receivables grew 30.0% against revenue growth of 8.0% (gap 22.0 points) in the fiscal year ended 2026-09-26.",
    );
    // 120/100 − 1 = 20%; gap 12 points → medium
    expect(one("receivables", { receivables: [120, 100, 93, 87, 81] }).severity).toBe("medium");
    // 117.8/100 − 1 = 17.8%; gap 9.8 points → none
    expect(run("receivables", { receivables: [117.8, 100, 93, 87, 81] })).toHaveLength(0);
  });

  test("DSO up more than 15% year on year", () => {
    // DSO0 = 130/1080 × 365 = 43.94; DSO1 = 100/1000 × 365 = 36.5; rise 20.4%
    const f = one("dso", { receivables: [130, 100, 93, 87, 81] });
    expect(f.detail).toBe("DSO rose from 36.5 to 43.9 days (20.4%) in the fiscal year ended 2026-09-26.");
    // 125 → DSO0 = 42.24, rise 15.7% → triggers; 120 → 40.56, rise 11.1% → none
    expect(run("dso", { receivables: [125, 100, 93, 87, 81] })).toHaveLength(1);
    expect(run("dso", { receivables: [120, 100, 93, 87, 81] })).toHaveLength(0);
  });

  test("inventory build: growth gap above 15 points", () => {
    // 62/50 − 1 = 24%; minus 8% = 16 points → medium
    expect(one("inventory", { inventory: [62, 50, 46.5, 43.5, 40.5] }).severity).toBe("medium");
    // 61/50 − 1 = 22%; gap 14 points → none
    expect(run("inventory", { inventory: [61, 50, 46.5, 43.5, 40.5] })).toHaveLength(0);
  });

  test("margin volatility: z-score of the latest EBIT margin beyond ±2", () => {
    const rev = [1000, 1000, 1000, 1000, 1000];
    // prior margins (oldest→newest) 20%, 19%, 21%, 20%: mean 20%, sample std 0.8165%
    // latest 18.3% → z = −1.7 / 0.8165 = −2.08 → medium; latest 18.4% → z = −1.96 → none
    const f = one("margin_z", { revenue: rev, ebit: [183, 200, 210, 190, 200] });
    expect(f.severity).toBe("medium");
    expect(f.detail).toContain("2.1 standard deviations below");
    expect(run("margin_z", { revenue: rev, ebit: [184, 200, 210, 190, 200] })).toHaveLength(0);
    // fewer than 4 years of history → no finding
    expect(run("margin_z", { revenue: rev.slice(0, 3), ebit: [100, 200, 210] })).toHaveLength(0);
  });

  test("non-operating items: pretax income vs EBIT beyond 25%", () => {
    // 150 / 216 − 1 = −30.6%
    expect(one("non_operating", { pretaxIncome: [150, 190, 177, 165, 154] }).detail).toContain("30.6% below");
    // 280 / 216 − 1 = +29.6%
    expect(one("non_operating", { pretaxIncome: [280, 190, 177, 165, 154] }).detail).toContain("29.6% above");
    // 170 / 216 − 1 = −21.3% → none
    expect(run("non_operating", { pretaxIncome: [170, 190, 177, 165, 154] })).toHaveLength(0);
  });

  test("tax rate swing: latest ETR vs the mean of prior years beyond 8 points", () => {
    // prior ETRs are 20%, 20%, 20%. latest 61.5/205 = 30% → gap 10 points → low
    const f = one("tax_rate", { incomeTaxExpense: [61.5, 38, 35.4, 33, 30.8] });
    expect(f.severity).toBe("low");
    expect(f.detail).toContain("30.0%");
    expect(f.detail).toContain("average of 20.0% over the previous 3 years (gap 10.0 points)");
    // 58.5/205 = 28.5% → gap 8.5 → triggers; 56.4/205 = 27.5% → gap 7.5 → none
    expect(run("tax_rate", { incomeTaxExpense: [58.5, 38, 35.4, 33, 30.8] })).toHaveLength(1);
    expect(run("tax_rate", { incomeTaxExpense: [56.4, 38, 35.4, 33, 30.8] })).toHaveLength(0);
  });

  test("capex persistently below 60% of D&A for 3 years", () => {
    // 15/30 = 0.5, 14/28 = 0.5, 13/26 = 0.5 → low
    expect(one("capex_da", { capex: [15, 14, 13, 24, 22] }).severity).toBe("low");
    // third year 17/26 = 0.65 → none; exactly 0.6 (18/30) is not below → none
    expect(run("capex_da", { capex: [15, 14, 17, 24, 22] })).toHaveLength(0);
    expect(run("capex_da", { capex: [18, 14, 13, 24, 22] })).toHaveLength(0);
  });

  test("leverage: debt up > 30% while revenue growth < 5%", () => {
    // 700/500 − 1 = 40%; revenue 1030/1000 − 1 = 3%
    const rev = [1030, 1000, 930, 870, 810];
    const f = one("leverage", { revenue: rev, totalDebt: [700, 500, 500, 500, 500] });
    expect(f.detail).toContain("grew 40.0%");
    // 640/500 − 1 = 28% → none; revenue growth 8% → none
    expect(run("leverage", { revenue: rev, totalDebt: [640, 500, 500, 500, 500] })).toHaveLength(0);
    expect(run("leverage", { totalDebt: [700, 500, 500, 500, 500] })).toHaveLength(0);
  });

  test("dilution: basic share growth above 4%", () => {
    // 105/100 − 1 = 5% → low; 103/100 − 1 = 3% → none
    expect(one("dilution", { basicShares: [105, 100, 100, 100, 100] }).severity).toBe("low");
    expect(run("dilution", { basicShares: [103, 100, 100, 100, 100] })).toHaveLength(0);
  });

  test("restatements: restated facts in the last 3 fiscal years only", () => {
    const f = run("restated", {}, [
      ["netIncome", 1],
      ["revenue", 1],
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]?.id).toBe("forensic:restated:2025-09-27");
    expect(f[0]?.severity).toBe("medium");
    expect(f[0]?.evidenceIds).toEqual(["xbrl:revenue:2025-09-27", "xbrl:netIncome:2025-09-27"]);
    // the 4th-newest year (index 3) is outside the window
    expect(run("restated", {}, [["netIncome", 3]])).toHaveLength(0);
  });

  test("missing inputs skip the rule quietly", () => {
    expect(run("accruals", { operatingCashFlow: [] })).toHaveLength(0);
    expect(run("cash_conversion", { operatingCashFlow: [] })).toHaveLength(0);
    expect(run("receivables", { receivables: [] })).toHaveLength(0);
    // a single year of history: no year-on-year rule can fire
    const one1 = buildHistory({
      series: Object.fromEntries(
        (Object.keys(buildHistory().items) as HistoryItem[]).map((i) => [i, [999999]]),
      ),
    });
    expect(forensicRules(one1)).toEqual([]);
    expect(forensicRules({ ...buildHistory(), items: {} })).toEqual([]);
  });
});
