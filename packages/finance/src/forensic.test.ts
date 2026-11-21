import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FinanceInputError } from "./errors.ts";
import {
  accrualsRatio,
  arithmeticMean,
  coefficientOfVariation,
  growthGap,
  zScoreOfLast,
} from "./forensic.ts";

describe("accrualsRatio", () => {
  it("(NI − CFO) / avg assets", () => {
    // (120 − 70) / 500 = 0.1
    const r = accrualsRatio({ netIncome: 120, operatingCashFlow: 70, averageTotalAssets: 500 });
    expect(r.value).toBeCloseTo(0.1, 9);
    expect(r.unit).toBe("ratio");
    expect(r.formulaId).toBe("forensic.accruals_ratio");
    // negative when cash flow exceeds earnings: (50 − 80) / 300 = −0.1
    expect(
      accrualsRatio({ netIncome: 50, operatingCashFlow: 80, averageTotalAssets: 300 }).value,
    ).toBeCloseTo(-0.1, 9);
  });
  it("rejects non-positive assets", () => {
    expect(() => accrualsRatio({ netIncome: 1, operatingCashFlow: 1, averageTotalAssets: 0 })).toThrow(
      FinanceInputError,
    );
  });
});

describe("arithmeticMean", () => {
  it("sum / n", () => {
    // (2 + 4 + 9) / 3 = 5
    expect(arithmeticMean({ values: [2, 4, 9] }).value).toBeCloseTo(5, 9);
    expect(() => arithmeticMean({ values: [] })).toThrow(FinanceInputError);
  });
});

describe("growthGap", () => {
  it("A − B", () => {
    // 0.31 − 0.085 = 0.225
    expect(growthGap({ growthA: 0.31, growthB: 0.085 }).value).toBeCloseTo(0.225, 9);
    expect(growthGap({ growthA: -0.1, growthB: 0.05 }).value).toBeCloseTo(-0.15, 9);
  });
  it("rejects NaN", () => {
    expect(() => growthGap({ growthA: Number.NaN, growthB: 0 })).toThrow(FinanceInputError);
  });
});

describe("coefficientOfVariation", () => {
  it("sample std / |mean|", () => {
    // values 2,4,6: mean 4, sample variance (4+0+4)/2 = 4, std 2 → 0.5
    expect(coefficientOfVariation({ values: [2, 4, 6] }).value).toBeCloseTo(0.5, 9);
    // negative mean uses |mean|: −2,−4,−6 → 0.5
    expect(coefficientOfVariation({ values: [-2, -4, -6] }).value).toBeCloseTo(0.5, 9);
  });
  it("needs ≥ 3 values and a non-zero mean", () => {
    expect(() => coefficientOfVariation({ values: [1, 2] })).toThrow(FinanceInputError);
    expect(() => coefficientOfVariation({ values: [-1, 0, 1] })).toThrow(FinanceInputError);
  });
});

describe("zScoreOfLast", () => {
  it("newest vs older values", () => {
    // older 10,12,14: mean 12, sample std 2; last 18 → (18 − 12)/2 = 3
    expect(zScoreOfLast({ values: [10, 12, 14, 18] }).value).toBeCloseTo(3, 9);
    // last 8 → −2
    expect(zScoreOfLast({ values: [10, 12, 14, 8] }).value).toBeCloseTo(-2, 9);
  });
  it("needs ≥ 4 values and spread", () => {
    expect(() => zScoreOfLast({ values: [1, 2, 3] })).toThrow(FinanceInputError);
    expect(() => zScoreOfLast({ values: [5, 5, 5, 9] })).toThrow(FinanceInputError);
  });
  it("property: z is invariant to shifting and positive scaling of the series", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1000, max: 1000, noNaN: true }), { minLength: 4, maxLength: 8 }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: 0.5, max: 50, noNaN: true }),
        (vals, shift, scale) => {
          let z0: number;
          try {
            z0 = zScoreOfLast({ values: vals }).value;
          } catch {
            return true; // zero spread: nothing to compare
          }
          const older = vals.slice(0, -1);
          const spread = Math.max(...older) - Math.min(...older);
          if (spread < 1e-3) return true; // near-zero spread amplifies float error
          const z1 = zScoreOfLast({ values: vals.map((v) => v * scale + shift) }).value;
          return Math.abs(z0 - z1) <= 1e-6 * Math.max(1, Math.abs(z0));
        },
      ),
    );
  });
});
