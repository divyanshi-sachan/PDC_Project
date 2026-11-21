import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { FinanceInputError } from "./errors.ts";
import {
  axisAround,
  cagr,
  effectiveTaxRate,
  growthRate,
  linearFade,
  mean,
  nwcChange,
  percentOf,
  projectByRatio,
  projectGrowth,
} from "./projection.ts";

describe("growthRate / cagr", () => {
  test("hand-computed", () => {
    // 110 / 100 − 1 = 0.10
    expect(growthRate({ previous: 100, current: 110 }).value).toBeCloseTo(0.1, 12);
    // (121 / 100)^(1/2) − 1 = 1.1 − 1 = 0.10
    expect(cagr({ first: 100, last: 121, years: 2 }).value).toBeCloseTo(0.1, 12);
  });
  test("errors", () => {
    expect(() => growthRate({ previous: 0, current: 1 })).toThrow(FinanceInputError);
    expect(() => cagr({ first: 100, last: -5, years: 2 })).toThrow(FinanceInputError);
    expect(() => cagr({ first: 100, last: 120, years: 0 })).toThrow(FinanceInputError);
  });
  test("property: compounding the CAGR over n years recovers the end value", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1e9, noNaN: true }),
        fc.double({ min: 1, max: 1e9, noNaN: true }),
        fc.integer({ min: 1, max: 20 }),
        (first, last, years) => {
          const g = cagr({ first, last, years }).value;
          expect(first * (1 + g) ** years).toBeCloseTo(last, 4);
        },
      ),
    );
  });
});

describe("percentOf / effectiveTaxRate", () => {
  test("hand-computed", () => {
    expect(percentOf({ part: 25, whole: 1000 }).value).toBeCloseTo(0.025, 12);
    // 20 / 80 = 0.25
    expect(effectiveTaxRate({ incomeTax: 20, pretaxIncome: 80 }).value).toBeCloseTo(0.25, 12);
  });
  test("non-positive denominators throw", () => {
    expect(() => percentOf({ part: 1, whole: 0 })).toThrow(FinanceInputError);
    expect(() => effectiveTaxRate({ incomeTax: 1, pretaxIncome: -5 })).toThrow(FinanceInputError);
  });
});

describe("projectGrowth / projectByRatio / nwcChange", () => {
  test("revenue path: 100 → 110 → 121 → 133.1", () => {
    const r = projectGrowth({ base: 100, growthRates: [0.1, 0.1, 0.1] }).value;
    expect(r[0]).toBeCloseTo(110, 10);
    expect(r[1]).toBeCloseTo(121, 10);
    expect(r[2]).toBeCloseTo(133.1, 10);
  });
  test("a −100% growth rate is rejected", () => {
    expect(() => projectGrowth({ base: 100, growthRates: [-1] })).toThrow(FinanceInputError);
  });
  test("by ratio: 200 × 0.3 = 60, 220 × 0.25 = 55", () => {
    expect(projectByRatio({ drivers: [200, 220], ratios: [0.3, 0.25] }).value).toEqual([60, 55]);
    expect(() => projectByRatio({ drivers: [1], ratios: [1, 2] })).toThrow(FinanceInputError);
  });
  test("ΔNWC: ratio 0.1; revenues 110, 121 from base 100 → 1.0, 1.1", () => {
    const d = nwcChange({ nwcRatio: 0.1, revenues: [110, 121], baseRevenue: 100 }).value;
    expect(d[0]).toBeCloseTo(1.0, 10);
    expect(d[1]).toBeCloseTo(1.1, 10);
  });
  test("negative NWC ratio releases cash when revenue grows", () => {
    expect(nwcChange({ nwcRatio: -0.05, revenues: [110], baseRevenue: 100 }).value[0]).toBeCloseTo(-0.5, 10);
  });
});

describe("linearFade / axisAround", () => {
  test("fade 0.10 → 0.04 over 4 points: 0.10, 0.08, 0.06, 0.04", () => {
    const v = linearFade({ start: 0.1, end: 0.04, steps: 4 }).value;
    expect(v).toHaveLength(4);
    for (const [k, x] of [0.1, 0.08, 0.06, 0.04].entries()) expect(v[k]).toBeCloseTo(x, 12);
  });
  test("single step returns the end value", () => {
    expect(linearFade({ start: 1, end: 5, steps: 1 }).value).toEqual([5]);
  });
  test("axis around 0.09 step 0.01 count 5 → 0.07 … 0.11", () => {
    const a = axisAround({ center: 0.09, step: 0.01, count: 5 }).value;
    for (const [k, x] of [0.07, 0.08, 0.09, 0.1, 0.11].entries()) expect(a[k]).toBeCloseTo(x, 12);
    expect(() => axisAround({ center: 1, step: 0.1, count: 4 })).toThrow(FinanceInputError);
  });
});

describe("mean", () => {
  test("(0.1 + 0.2 + 0.3) / 3 = 0.2", () => {
    expect(mean({ values: [0.1, 0.2, 0.3] }).value).toBeCloseTo(0.2, 12);
  });
  test("empty throws", () => {
    expect(() => mean({ values: [] })).toThrow(FinanceInputError);
  });
});
