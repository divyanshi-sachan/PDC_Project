import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { FinanceInputError } from "./errors.ts";
import { betaFromReturns, dilutedSharesEstimate, marketCap, relevered, simpleReturns } from "./marketdata.ts";

describe("marketCap", () => {
  test("$400 × 7.5bn shares = $3.0tn", () => {
    expect(marketCap({ price: 400, shares: 7.5e9 }).value).toBeCloseTo(3e12, 0);
  });
  test("rejects non-positive inputs", () => {
    expect(() => marketCap({ price: 0, shares: 1 })).toThrow(FinanceInputError);
    expect(() => marketCap({ price: 10, shares: -1 })).toThrow(FinanceInputError);
  });
  test("property: scales linearly in both inputs", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1e4, noNaN: true }),
        fc.double({ min: 1, max: 1e11, noNaN: true }),
        (p, s) => {
          expect(marketCap({ price: 2 * p, shares: s }).value).toBeCloseTo(
            2 * marketCap({ price: p, shares: s }).value,
            3,
          );
        },
      ),
    );
  });
});

describe("dilutedSharesEstimate", () => {
  test("cover 100 × (diluted 102 / basic 100) = 102", () => {
    expect(
      dilutedSharesEstimate({ coverShares: 100, weightedBasic: 100, weightedDiluted: 102 }).value,
    ).toBeCloseTo(102, 12);
  });
  test("a ratio below 1 or implausibly high is rejected", () => {
    expect(() =>
      dilutedSharesEstimate({ coverShares: 100, weightedBasic: 100, weightedDiluted: 90 }),
    ).toThrow(FinanceInputError);
    expect(() =>
      dilutedSharesEstimate({ coverShares: 100, weightedBasic: 100, weightedDiluted: 160 }),
    ).toThrow(FinanceInputError);
  });
});

describe("simpleReturns / betaFromReturns", () => {
  test("returns: 100 → 110 → 99 gives +10%, −10%", () => {
    const r = simpleReturns({ prices: [100, 110, 99] }).value;
    expect(r[0]).toBeCloseTo(0.1, 12);
    expect(r[1]).toBeCloseTo(-0.1, 12);
  });
  test("beta of an asset that moves 1.5× the market is 1.5", () => {
    const m = [0.01, -0.02, 0.03, 0.005, -0.01];
    expect(betaFromReturns({ assetReturns: m.map((x) => 1.5 * x), marketReturns: m }).value).toBeCloseTo(
      1.5,
      12,
    );
  });
  test("hand-computed: Cov/Var", () => {
    // asset [0.02, 0.00, 0.04], market [0.01, 0.00, 0.03]
    // means 0.02 and 0.013333…; deviations a: [0, −0.02, 0.02], m: [−0.003333, −0.013333, 0.016667]
    // Cov numerator = 0·(−0.003333) + (−0.02)(−0.013333) + 0.02·0.016667 = 0.000266667 + 0.000333333 = 0.0006
    // Var numerator = 0.00001111 + 0.00017778 + 0.00027778 = 0.00046667 → β = 0.0006 / 0.00046667 = 1.285714…
    expect(
      betaFromReturns({ assetReturns: [0.02, 0, 0.04], marketReturns: [0.01, 0, 0.03] }).value,
    ).toBeCloseTo(9 / 7, 10);
  });
  test("a constant benchmark or mismatched lengths are rejected", () => {
    expect(() => betaFromReturns({ assetReturns: [1, 2, 3], marketReturns: [0.01, 0.01, 0.01] })).toThrow(
      FinanceInputError,
    );
    expect(() => betaFromReturns({ assetReturns: [1, 2, 3], marketReturns: [1, 2] })).toThrow(
      FinanceInputError,
    );
    expect(() => betaFromReturns({ assetReturns: [1, 2], marketReturns: [1, 2] })).toThrow(FinanceInputError);
  });
  test("property: beta(a·market + noise-free offset) = a", () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.double({ min: -0.1, max: 0.1, noNaN: true }), { minLength: 5, maxLength: 30 })
          .filter((xs) => Math.max(...xs) - Math.min(...xs) > 1e-3),
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: -0.01, max: 0.01, noNaN: true }),
        (m, a, c) => {
          const asset = m.map((x) => a * x + c);
          expect(betaFromReturns({ assetReturns: asset, marketReturns: m }).value).toBeCloseTo(a, 6);
        },
      ),
    );
  });
});

describe("relevered", () => {
  test("β_U 0.8, D/E 0.5, t 25% → 0.8 × (1 + 0.75 × 0.5) = 1.1", () => {
    expect(relevered({ unleveredBeta: 0.8, debtToEquity: 0.5, taxRate: 0.25 }).value).toBeCloseTo(1.1, 12);
  });
  test("zero debt leaves beta unchanged; bad inputs throw", () => {
    expect(relevered({ unleveredBeta: 0.9, debtToEquity: 0, taxRate: 0.2 }).value).toBeCloseTo(0.9, 12);
    expect(() => relevered({ unleveredBeta: 0.9, debtToEquity: -1, taxRate: 0.2 })).toThrow(
      FinanceInputError,
    );
    expect(() => relevered({ unleveredBeta: 0.9, debtToEquity: 1, taxRate: 1.5 })).toThrow(FinanceInputError);
  });
});
