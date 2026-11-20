import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dcfValuation } from "./dcf.ts";
import { FinanceInputError } from "./errors.ts";
import { sensitivityGrid, waccExitMultipleSensitivity, waccGrowthSensitivity } from "./sensitivity.ts";

describe("sensitivityGrid", () => {
  it("hand-computed: values[r][c] = r·c", () => {
    // rows [1, 2], cols [10, 20, 30] → [[10, 20, 30], [20, 40, 60]]
    const g = sensitivityGrid([1, 2], [10, 20, 30], (r, c) => r * c);
    expect(g.value.rows).toEqual([1, 2]);
    expect(g.value.cols).toEqual([10, 20, 30]);
    expect(g.value.values).toEqual([
      [10, 20, 30],
      [20, 40, 60],
    ]);
    expect(g.formulaId).toBe("sensitivity.grid");
  });
  it("meta.inputs cannot overwrite the real axes", () => {
    const g = sensitivityGrid([1, 2], [3], (r, c) => r + c, {
      inputs: { rowValues: [99], colValues: [99], x: 1 },
    });
    expect(g.inputs.rowValues).toEqual([1, 2]);
    expect(g.inputs.colValues).toEqual([3]);
    expect(g.inputs.x).toBe(1);
  });
  it("throws on empty axes and non-finite cells", () => {
    expect(() => sensitivityGrid([], [1], (r, c) => r + c)).toThrow(FinanceInputError);
    expect(() => sensitivityGrid([1], [], (r, c) => r + c)).toThrow(FinanceInputError);
    expect(() => sensitivityGrid([0], [1], (r, c) => c / r)).toThrow(FinanceInputError);
  });
});

describe("waccGrowthSensitivity", () => {
  it("hand-computed 1-year cell", () => {
    // CF = [100], w = 10%, g = 0%: TV = 100·1/0.10 = 1000
    // EV = 100/1.1 + 1000/1.1 = 1100/1.1 = 1000
    // w = 10%, g = 2%: TV = 102/0.08 = 1275; EV = (100 + 1275)/1.1 = 1250
    const g = waccGrowthSensitivity({ cashflows: [100], waccValues: [0.1], growthValues: [0, 0.02] });
    expect(g.value.values[0]?.[0]).toBeCloseTo(1000, 9);
    expect(g.value.values[0]?.[1]).toBeCloseTo(1250, 9);
    expect(g.formulaId).toBe("sensitivity.wacc_growth");
    expect(g.unit).toBe("currency");
  });
  it("mid-year discounts the Gordon TV at N − 0.5", () => {
    // CF = [100], w = 21%, g = 0%: TV = 100/0.21; mid-year EV = 100/1.1 + (100/0.21)/1.1 (exponent 0.5)
    const g = waccGrowthSensitivity({
      cashflows: [100],
      waccValues: [0.21],
      growthValues: [0],
      midYear: true,
    });
    expect(g.value.values[0]?.[0]).toBeCloseTo(100 / 1.1 + 100 / 0.21 / 1.1, 9);
  });
  it("throws when any g ≥ any WACC on the grid", () => {
    expect(() =>
      waccGrowthSensitivity({ cashflows: [100], waccValues: [0.03, 0.1], growthValues: [0.03] }),
    ).toThrow(FinanceInputError);
    expect(() => waccGrowthSensitivity({ cashflows: [], waccValues: [0.1], growthValues: [0.02] })).toThrow(
      FinanceInputError,
    );
  });
  it("property: EV decreases down the WACC axis and increases along the g axis", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 1, max: 1e5, noNaN: true }), { minLength: 1, maxLength: 8 }),
        (cfs) => {
          const g = waccGrowthSensitivity({
            cashflows: cfs,
            waccValues: [0.07, 0.08, 0.09, 0.1],
            growthValues: [0, 0.01, 0.02, 0.03],
          }).value.values;
          for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
              const v = g[r]?.[c] ?? Number.NaN;
              if (r > 0) expect(v).toBeLessThan(g[r - 1]?.[c] ?? Number.NaN);
              if (c > 0) expect(v).toBeGreaterThan(g[r]?.[c - 1] ?? Number.NaN);
            }
          }
        },
      ),
    );
  });
});

describe("waccExitMultipleSensitivity", () => {
  it("hand-computed cells and agreement with dcfValuation", () => {
    // CF = [110, 121], EBITDA_N = 100, w = 10%, m = 12.1: TV = 1210
    // EV = 110/1.1 + 121/1.21 + 1210/1.21 = 100 + 100 + 1000 = 1200
    const g = waccExitMultipleSensitivity({
      cashflows: [110, 121],
      finalYearMetric: 100,
      waccValues: [0.1, 0.12],
      multipleValues: [12.1, 8],
    });
    expect(g.value.values[0]?.[0]).toBeCloseTo(1200, 9);
    expect(g.value.values[1]?.[1]).toBeCloseTo(
      dcfValuation({ cashflows: [110, 121], wacc: 0.12, terminalValue: 800, terminalMethod: "exitMultiple" })
        .value.enterpriseValue,
      9,
    );
    expect(g.formulaId).toBe("sensitivity.wacc_exit_multiple");
  });
  it("mid-year keeps the exit-multiple TV at full N", () => {
    // CF = [100], metric 10, m = 12.1, w = 21%: EV = 100/1.1 + 121/1.21 = 90.909… + 100
    const g = waccExitMultipleSensitivity({
      cashflows: [100],
      finalYearMetric: 10,
      waccValues: [0.21],
      multipleValues: [12.1],
      midYear: true,
    });
    expect(g.value.values[0]?.[0]).toBeCloseTo(100 / 1.1 + 100, 9);
  });
  it("throws on a non-positive multiple or metric", () => {
    expect(() =>
      waccExitMultipleSensitivity({
        cashflows: [1],
        finalYearMetric: 1,
        waccValues: [0.1],
        multipleValues: [0],
      }),
    ).toThrow(FinanceInputError);
    expect(() =>
      waccExitMultipleSensitivity({
        cashflows: [1],
        finalYearMetric: -1,
        waccValues: [0.1],
        multipleValues: [5],
      }),
    ).toThrow(FinanceInputError);
  });
});
