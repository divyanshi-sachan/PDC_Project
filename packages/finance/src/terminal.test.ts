import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FinanceInputError } from "./errors.ts";
import {
  exitMultipleTerminalValue,
  gordonGrowthTerminalValue,
  impliedExitMultiple,
  impliedPerpetualGrowth,
} from "./terminal.ts";
import { relClose } from "./test-utils.ts";

describe("gordonGrowthTerminalValue", () => {
  it("hand-computed: 100·1.02 / (0.10 − 0.02) = 102 / 0.08 = 1275", () => {
    const r = gordonGrowthTerminalValue({ finalYearFcf: 100, wacc: 0.1, growthRate: 0.02 });
    expect(r.value).toBeCloseTo(1275, 9);
    expect(r.formulaId).toBe("terminal.gordon");
  });
  it("throws when g ≥ WACC", () => {
    expect(() => gordonGrowthTerminalValue({ finalYearFcf: 100, wacc: 0.05, growthRate: 0.05 })).toThrow(
      FinanceInputError,
    );
    expect(() => gordonGrowthTerminalValue({ finalYearFcf: 100, wacc: 0.05, growthRate: 0.06 })).toThrow(
      FinanceInputError,
    );
    try {
      gordonGrowthTerminalValue({ finalYearFcf: 100, wacc: 0.05, growthRate: 0.06 });
    } catch (e) {
      expect((e as FinanceInputError).code).toBe("GROWTH_GE_DISCOUNT_RATE");
    }
  });
  it("throws on non-finite FCF", () => {
    expect(() =>
      gordonGrowthTerminalValue({ finalYearFcf: Number.NaN, wacc: 0.1, growthRate: 0.02 }),
    ).toThrow(FinanceInputError);
  });
});

describe("exitMultipleTerminalValue", () => {
  it("hand-computed: 150 × 8 = 1200", () => {
    expect(exitMultipleTerminalValue({ finalYearMetric: 150, exitMultiple: 8 }).value).toBeCloseTo(1200, 9);
  });
  it("throws on non-positive metric or multiple", () => {
    expect(() => exitMultipleTerminalValue({ finalYearMetric: -1, exitMultiple: 8 })).toThrow(
      FinanceInputError,
    );
    expect(() => exitMultipleTerminalValue({ finalYearMetric: 1, exitMultiple: 0 })).toThrow(
      FinanceInputError,
    );
  });
});

describe("implied growth / implied multiple", () => {
  it("hand-computed implied growth", () => {
    // TV = 150 × 8.5 = 1275; g = (1275·0.10 − 100) / (1275 + 100) = 27.5 / 1375 = 0.02
    const r = impliedPerpetualGrowth({
      finalYearFcf: 100,
      finalYearMetric: 150,
      exitMultiple: 8.5,
      wacc: 0.1,
    });
    expect(r.value).toBeCloseTo(0.02, 9);
    expect(r.inputs.terminalValue).toBeCloseTo(1275, 9);
  });
  it("hand-computed implied exit multiple", () => {
    // Gordon TV = 100·1.02/0.08 = 1275; multiple = 1275 / 150 = 8.5
    expect(
      impliedExitMultiple({ finalYearFcf: 100, finalYearMetric: 150, wacc: 0.1, growthRate: 0.02 }).value,
    ).toBeCloseTo(8.5, 9);
  });
  it("rejects FCF_N ≤ 0, which would imply g ≥ WACC", () => {
    // Unguarded: TV = 100 × 10 = 1000; g = (1000·0.1 − (−10)) / (1000 − 10) = 110 / 990 = 0.111… > 0.1
    expect(() =>
      impliedPerpetualGrowth({ finalYearFcf: -10, finalYearMetric: 100, exitMultiple: 10, wacc: 0.1 }),
    ).toThrow(FinanceInputError);
    expect(() =>
      impliedPerpetualGrowth({ finalYearFcf: 0, finalYearMetric: 100, exitMultiple: 10, wacc: 0.1 }),
    ).toThrow(FinanceInputError);
    expect(() =>
      impliedExitMultiple({ finalYearFcf: -10, finalYearMetric: 100, wacc: 0.1, growthRate: 0.02 }),
    ).toThrow(FinanceInputError);
    expect(() =>
      impliedExitMultiple({ finalYearFcf: 0, finalYearMetric: 100, wacc: 0.1, growthRate: 0.02 }),
    ).toThrow(FinanceInputError);
  });
  it("throws on invalid inputs", () => {
    expect(() =>
      impliedPerpetualGrowth({ finalYearFcf: -2000, finalYearMetric: 150, exitMultiple: 8.5, wacc: 0.1 }),
    ).toThrow(FinanceInputError);
    expect(() =>
      impliedPerpetualGrowth({ finalYearFcf: 100, finalYearMetric: 0, exitMultiple: 8.5, wacc: 0.1 }),
    ).toThrow(FinanceInputError);
    expect(() =>
      impliedExitMultiple({ finalYearFcf: 100, finalYearMetric: 0, wacc: 0.1, growthRate: 0.02 }),
    ).toThrow(FinanceInputError);
    expect(() =>
      impliedExitMultiple({ finalYearFcf: 100, finalYearMetric: 150, wacc: 0.1, growthRate: 0.1 }),
    ).toThrow(FinanceInputError);
  });
  it("property: implied growth and implied multiple are inverses", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1e6, noNaN: true }),
        fc.double({ min: 1, max: 1e6, noNaN: true }),
        fc.double({ min: 0.5, max: 40, noNaN: true }),
        fc.double({ min: 0.02, max: 0.3, noNaN: true }),
        (fcf, metric, multiple, w) => {
          const g = impliedPerpetualGrowth({
            finalYearFcf: fcf,
            finalYearMetric: metric,
            exitMultiple: multiple,
            wacc: w,
          }).value;
          expect(g).toBeLessThan(w);
          const back = impliedExitMultiple({
            finalYearFcf: fcf,
            finalYearMetric: metric,
            wacc: w,
            growthRate: g,
          }).value;
          expect(relClose(back, multiple, 1e-8)).toBe(true);
        },
      ),
    );
  });
});
