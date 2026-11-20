import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  evToEbit,
  evToEbitda,
  evToRevenue,
  impliedValuationRange,
  type PeerFinancials,
  peerMultipleStats,
  priceToEarnings,
  summaryStats,
} from "./comps.ts";
import { FinanceInputError } from "./errors.ts";

describe("single multiples", () => {
  it("hand-computed EV/Revenue, EV/EBITDA, EV/EBIT, P/E", () => {
    expect(evToRevenue({ enterpriseValue: 1000, revenue: 500 }).value).toBeCloseTo(2, 9); // 1000/500
    expect(evToEbitda({ enterpriseValue: 1000, ebitda: 125 }).value).toBeCloseTo(8, 9); // 1000/125
    expect(evToEbit({ enterpriseValue: 1000, ebit: 80 }).value).toBeCloseTo(12.5, 9); // 1000/80
    expect(priceToEarnings({ equityValue: 800, netIncome: 50 }).value).toBeCloseTo(16, 9); // 800/50
  });
  it("throws on non-positive denominators", () => {
    expect(() => evToRevenue({ enterpriseValue: 1, revenue: 0 })).toThrow(FinanceInputError);
    expect(() => evToEbitda({ enterpriseValue: 1, ebitda: -1 })).toThrow(FinanceInputError);
    expect(() => evToEbit({ enterpriseValue: 1, ebit: 0 })).toThrow(FinanceInputError);
    expect(() => priceToEarnings({ equityValue: 1, netIncome: -1 })).toThrow(FinanceInputError);
    expect(() => evToEbitda({ enterpriseValue: Number.NaN, ebitda: 1 })).toThrow(FinanceInputError);
  });
});

describe("summaryStats", () => {
  it("matches Excel QUARTILE.INC on 1..10", () => {
    // sorted 1..10, n = 10; p25 rank 0.25·9 = 2.25 → 3 + 0.25·1 = 3.25
    // median rank 4.5 → 5.5; p75 rank 6.75 → 7.75; mean 55/10 = 5.5
    const obs = Array.from({ length: 10 }, (_, k) => ({ name: `p${k + 1}`, value: k + 1 }));
    const s = summaryStats(obs).value;
    expect(s.n).toBe(10);
    expect(s.min).toBeCloseTo(1, 9);
    expect(s.p25).toBeCloseTo(3.25, 9);
    expect(s.median).toBeCloseTo(5.5, 9);
    expect(s.mean).toBeCloseTo(5.5, 9);
    expect(s.p75).toBeCloseTo(7.75, 9);
    expect(s.max).toBeCloseTo(10, 9);
  });
  it("single observation: every stat equals it", () => {
    const s = summaryStats([{ name: "a", value: 7 }]).value;
    expect([s.min, s.p25, s.median, s.mean, s.p75, s.max]).toEqual([7, 7, 7, 7, 7, 7]);
  });
  it("n = 1: every percentile equals the single value", () => {
    // rank p·(1 − 1) = 0 for every p → x[0]
    const s = summaryStats([{ name: "a", value: 4.2 }]).value;
    expect(s.p25).toBeCloseTo(4.2, 9);
    expect(s.median).toBeCloseTo(4.2, 9);
    expect(s.p75).toBeCloseTo(4.2, 9);
  });
  it("n = 2: percentiles interpolate linearly between the two values", () => {
    // sorted [10, 20]; p25 rank 0.25 → 10 + 0.25·10 = 12.5; median rank 0.5 → 15; p75 rank 0.75 → 17.5
    const s = summaryStats([
      { name: "b", value: 20 },
      { name: "a", value: 10 },
    ]).value;
    expect(s.min).toBeCloseTo(10, 9);
    expect(s.p25).toBeCloseTo(12.5, 9);
    expect(s.median).toBeCloseTo(15, 9);
    expect(s.mean).toBeCloseTo(15, 9);
    expect(s.p75).toBeCloseTo(17.5, 9);
    expect(s.max).toBeCloseTo(20, 9);
  });
  it("unit defaults to multiple and can be overridden", () => {
    expect(summaryStats([{ name: "a", value: 1 }]).unit).toBe("multiple");
    expect(summaryStats([{ name: "a", value: 0.2 }], "ratio").unit).toBe("ratio");
  });
  it("excludes non-finite observations and reports them", () => {
    const s = summaryStats([
      { name: "a", value: 1 },
      { name: "b", value: Number.NaN },
      { name: "c", value: 3 },
    ]).value;
    expect(s.n).toBe(2);
    expect(s.excluded).toEqual([{ name: "b", reason: "non_finite" }]);
  });
  it("throws EMPTY_INPUT if nothing is left", () => {
    expect(() => summaryStats([])).toThrow(FinanceInputError);
    expect(() => summaryStats([{ name: "x", value: Number.POSITIVE_INFINITY }])).toThrow(FinanceInputError);
  });
  it("property: min ≤ p25 ≤ median ≤ p75 ≤ max and min ≤ mean ≤ max", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1e6, max: 1e6, noNaN: true }), { minLength: 1, maxLength: 50 }),
        (xs) => {
          const s = summaryStats(xs.map((value, k) => ({ name: String(k), value }))).value;
          expect(s.min).toBeLessThanOrEqual(s.p25);
          expect(s.p25).toBeLessThanOrEqual(s.median);
          expect(s.median).toBeLessThanOrEqual(s.p75);
          expect(s.p75).toBeLessThanOrEqual(s.max);
          expect(s.mean).toBeGreaterThanOrEqual(s.min - 1e-9);
          expect(s.mean).toBeLessThanOrEqual(s.max + 1e-9);
        },
      ),
    );
  });
});

const peers: PeerFinancials[] = [
  { name: "A", enterpriseValue: 1000, equityValue: 800, revenue: 500, ebitda: 100, ebit: 80, netIncome: 50 },
  {
    name: "B",
    enterpriseValue: 1200,
    equityValue: 1000,
    revenue: 400,
    ebitda: 150,
    ebit: 100,
    netIncome: 40,
  },
  { name: "C", enterpriseValue: 900, equityValue: 700, revenue: 450, ebitda: 75, ebit: 60, netIncome: 35 },
  {
    name: "D",
    enterpriseValue: 2000,
    equityValue: 1500,
    revenue: 1000,
    ebitda: 160,
    ebit: 120,
    netIncome: -10,
  },
  { name: "E", enterpriseValue: 500, equityValue: 450, revenue: 300, ebitda: -20, ebit: -30, netIncome: -40 },
  {
    name: "F",
    enterpriseValue: Number.NaN,
    equityValue: Number.NaN,
    revenue: 100,
    ebitda: 10,
    ebit: 5,
    netIncome: 2,
  },
];

describe("peerMultipleStats", () => {
  it("hand-computed EV/EBITDA stats with exclusions", () => {
    // A 1000/100 = 10, B 1200/150 = 8, C 900/75 = 12, D 2000/160 = 12.5
    // E excluded (EBITDA −20 ≤ 0), F excluded (EV NaN)
    // sorted [8, 10, 12, 12.5]; n = 4
    // p25 rank 0.75 → 8 + 0.75·(10 − 8) = 9.5
    // median rank 1.5 → 10 + 0.5·(12 − 10) = 11
    // p75 rank 2.25 → 12 + 0.25·(12.5 − 12) = 12.125
    // mean = (8 + 10 + 12 + 12.5) / 4 = 42.5 / 4 = 10.625
    const r = peerMultipleStats(peers, "evEbitda");
    const s = r.value;
    expect(s.n).toBe(4);
    expect(s.min).toBeCloseTo(8, 9);
    expect(s.p25).toBeCloseTo(9.5, 9);
    expect(s.median).toBeCloseTo(11, 9);
    expect(s.mean).toBeCloseTo(10.625, 9);
    expect(s.p75).toBeCloseTo(12.125, 9);
    expect(s.max).toBeCloseTo(12.5, 9);
    expect(s.excluded).toEqual([
      { name: "E", reason: "non_positive_denominator" },
      { name: "F", reason: "non_finite" },
    ]);
    expect(r.formulaId).toBe("comps.peer_stats");
    expect(r.inputs.kind).toBe("evEbitda");
  });
  it("hand-computed P/E excludes loss-makers", () => {
    // A 800/50 = 16, B 1000/40 = 25, C 700/35 = 20; D, E loss-making; F NaN. Median = 20
    const s = peerMultipleStats(peers, "pe").value;
    expect(s.n).toBe(3);
    expect(s.median).toBeCloseTo(20, 9);
    expect(s.excluded.map((e) => e.name)).toEqual(["D", "E", "F"]);
  });
  it("EV/Revenue and EV/EBIT keep every finite peer with a positive denominator", () => {
    expect(peerMultipleStats(peers, "evRevenue").value.n).toBe(5);
    expect(peerMultipleStats(peers, "evEbit").value.n).toBe(4);
  });
  it("throws EMPTY_INPUT when every peer is excluded", () => {
    expect(() => peerMultipleStats([peers[4] as PeerFinancials], "evEbitda")).toThrow(FinanceInputError);
  });
});

describe("impliedValuationRange", () => {
  it("hand-computed: EBITDA 200 × (9.5, 11, 12.125) = (1900, 2200, 2425)", () => {
    const stats = peerMultipleStats(peers, "evEbitda").value;
    const r = impliedValuationRange({ kind: "evEbitda", targetMetric: 200, stats });
    expect(r.value.basis).toBe("enterpriseValue");
    expect(r.value.low).toBeCloseTo(1900, 9);
    expect(r.value.mid).toBeCloseTo(2200, 9);
    expect(r.value.high).toBeCloseTo(2425, 9);
  });
  it("P/E implies an equity value", () => {
    // 20 × 30 = 600
    const r = impliedValuationRange({
      kind: "pe",
      targetMetric: 30,
      stats: { p25: 18, median: 20, p75: 22.5 },
    });
    expect(r.value.basis).toBe("equityValue");
    expect(r.value.mid).toBeCloseTo(600, 9);
  });
  it("throws on a non-positive target metric", () => {
    expect(() =>
      impliedValuationRange({ kind: "evEbitda", targetMetric: -5, stats: { p25: 1, median: 2, p75: 3 } }),
    ).toThrow(FinanceInputError);
  });
});
