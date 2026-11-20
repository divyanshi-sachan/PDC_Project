import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dcfValuation, discountFactors, presentValue, ufcf } from "./dcf.ts";
import { FinanceInputError } from "./errors.ts";
import { gordonGrowthTerminalValue } from "./terminal.ts";
import { relClose } from "./test-utils.ts";

const positiveCashflows = fc.array(fc.double({ min: 0.01, max: 1e6, noNaN: true }), {
  minLength: 1,
  maxLength: 15,
});

describe("ufcf", () => {
  it("hand-computed: 200·(1 − 0.25) + 40 − 60 − 10 = 150 + 40 − 60 − 10 = 120", () => {
    const r = ufcf({ ebit: 200, taxRate: 0.25, depreciationAndAmortization: 40, capex: 60, changeInNwc: 10 });
    expect(r.value).toBeCloseTo(120, 9);
    expect(r.formulaId).toBe("dcf.ufcf");
    expect(r.unit).toBe("currency");
  });
  it("NWC release adds cash: 150 + 40 − 60 − (−10) = 140", () => {
    expect(
      ufcf({ ebit: 200, taxRate: 0.25, depreciationAndAmortization: 40, capex: 60, changeInNwc: -10 }).value,
    ).toBeCloseTo(140, 9);
  });
  it("negative EBIT gets a full tax shield: −100·(1 − 0.25) + 40 − 60 − 10 = −75 − 30 = −105", () => {
    // Without the shield (tax floored at 0) it would be −100 + 40 − 60 − 10 = −130.
    expect(
      ufcf({ ebit: -100, taxRate: 0.25, depreciationAndAmortization: 40, capex: 60, changeInNwc: 10 }).value,
    ).toBeCloseTo(-105, 9);
  });
  it("throws on negative capex (sign convention), negative D&A, bad tax rate, NaN", () => {
    const base = { ebit: 200, taxRate: 0.25, depreciationAndAmortization: 40, capex: 60, changeInNwc: 10 };
    expect(() => ufcf({ ...base, capex: -60 })).toThrow(FinanceInputError);
    expect(() => ufcf({ ...base, depreciationAndAmortization: -1 })).toThrow(FinanceInputError);
    expect(() => ufcf({ ...base, taxRate: 1.01 })).toThrow(FinanceInputError);
    expect(() => ufcf({ ...base, ebit: Number.NaN })).toThrow(FinanceInputError);
  });
});

describe("discountFactors", () => {
  it("end-year at 10%: 1/1.1, 1/1.21, 1/1.331", () => {
    const r = discountFactors(0.1, 3);
    expect(r.value).toHaveLength(3);
    expect(r.value[0]).toBeCloseTo(1 / 1.1, 9); // 0.909090909…
    expect(r.value[1]).toBeCloseTo(1 / 1.21, 9); // 0.826446281…
    expect(r.value[2]).toBeCloseTo(1 / 1.331, 9); // 0.751314801…
    expect(r.inputs.midYear).toBe(false);
  });
  it("mid-year at 21%: exponents 0.5 and 1.5 → 1/1.1 and 1/(1.21·1.1)", () => {
    // 1.21^0.5 = 1.1, 1.21^1.5 = 1.331
    const r = discountFactors(0.21, 2, { midYear: true });
    expect(r.value[0]).toBeCloseTo(1 / 1.1, 9);
    expect(r.value[1]).toBeCloseTo(1 / 1.331, 9);
  });
  it("throws on rate ≤ −1 and a non-positive-integer n", () => {
    expect(() => discountFactors(-1, 3)).toThrow(FinanceInputError);
    expect(() => discountFactors(0.1, 0)).toThrow(FinanceInputError);
    expect(() => discountFactors(0.1, 2.5)).toThrow(FinanceInputError);
  });
});

describe("presentValue", () => {
  it("hand-computed: 110/1.1 + 121/1.21 = 100 + 100 = 200", () => {
    expect(presentValue([110, 121], 0.1).value).toBeCloseTo(200, 9);
  });
  it("zero rate: PV = sum", () => {
    expect(presentValue([1, 2, 3], 0).value).toBeCloseTo(6, 9);
  });
  it("throws on empty or non-finite cashflows", () => {
    expect(() => presentValue([], 0.1)).toThrow(FinanceInputError);
    expect(() => presentValue([1, Number.NaN], 0.1)).toThrow(FinanceInputError);
  });
});

describe("dcfValuation", () => {
  it("hand-computed 2-year DCF", () => {
    // PV(CF) = 110/1.1 + 121/1.21 = 200
    // PV(TV) = 1331/1.21 = 1100
    // EV = 1300; TV share = 1100/1300 = 0.846153846…
    const r = dcfValuation({
      cashflows: [110, 121],
      wacc: 0.1,
      terminalValue: 1331,
      terminalMethod: "gordon",
    });
    expect(r.value.pvOfCashflows).toBeCloseTo(200, 9);
    expect(r.value.pvOfTerminal).toBeCloseTo(1100, 9);
    expect(r.value.enterpriseValue).toBeCloseTo(1300, 9);
    expect(r.value.terminalShareOfEV).toBeCloseTo(1100 / 1300, 9);
    expect(r.formulaId).toBe("dcf.valuation");
    expect(r.inputs.tvExponent).toBe(2);
  });
  it("end-year: both terminal methods discount the TV at N", () => {
    const g = dcfValuation({
      cashflows: [110, 121],
      wacc: 0.1,
      terminalValue: 1331,
      terminalMethod: "gordon",
    });
    const x = dcfValuation({
      cashflows: [110, 121],
      wacc: 0.1,
      terminalValue: 1331,
      terminalMethod: "exitMultiple",
    });
    expect(g.value.enterpriseValue).toBeCloseTo(x.value.enterpriseValue, 9);
  });
  it("mid-year exit multiple: cashflows at t − 0.5, TV at full N", () => {
    // rate 21%: PV(CF) = 100/1.1 + 100/1.331; PV(TV) = 1464.1/1.21² = 1464.1/1.4641 = 1000 (N = 2)
    const r = dcfValuation({
      cashflows: [100, 100],
      wacc: 0.21,
      terminalValue: 1464.1,
      terminalMethod: "exitMultiple",
      midYear: true,
    });
    expect(r.value.pvOfCashflows).toBeCloseTo(100 / 1.1 + 100 / 1.331, 9);
    expect(r.value.pvOfTerminal).toBeCloseTo(1000, 9);
    expect(r.inputs.tvExponent).toBe(2);
  });
  it("mid-year Gordon: TV at N − 0.5", () => {
    // rate 21%: PV(TV) = 1464.1/1.21^1.5 = 1464.1/1.331 = 1100 (N − 0.5 = 1.5)
    const r = dcfValuation({
      cashflows: [100, 100],
      wacc: 0.21,
      terminalValue: 1464.1,
      terminalMethod: "gordon",
      midYear: true,
    });
    expect(r.value.pvOfTerminal).toBeCloseTo(1100, 9);
    expect(r.inputs.tvExponent).toBe(1.5);
  });
  it("terminalShareOfEV is null when EV ≤ 0", () => {
    const r = dcfValuation({
      cashflows: [-100],
      wacc: 0.1,
      terminalValue: 0,
      terminalMethod: "exitMultiple",
    });
    expect(r.value.enterpriseValue).toBeLessThan(0);
    expect(r.value.terminalShareOfEV).toBeNull();
  });
  it("throws on invalid inputs", () => {
    const m = "gordon" as const;
    expect(() => dcfValuation({ cashflows: [], wacc: 0.1, terminalValue: 1, terminalMethod: m })).toThrow(
      FinanceInputError,
    );
    expect(() => dcfValuation({ cashflows: [1], wacc: -1, terminalValue: 1, terminalMethod: m })).toThrow(
      FinanceInputError,
    );
    expect(() =>
      dcfValuation({ cashflows: [1], wacc: 0.1, terminalValue: Number.NaN, terminalMethod: m }),
    ).toThrow(FinanceInputError);
    expect(() =>
      dcfValuation({
        cashflows: [1],
        wacc: 0.1,
        terminalValue: 1,
        terminalMethod: "perpetuity" as unknown as "gordon",
      }),
    ).toThrow(FinanceInputError);
  });

  const methodArb = fc.constantFrom("gordon" as const, "exitMultiple" as const);

  it("property: higher WACC → lower EV (fixed positive TV, either method, either timing)", () => {
    fc.assert(
      fc.property(
        positiveCashflows,
        fc.double({ min: 0, max: 1e7, noNaN: true }),
        fc.double({ min: 0.01, max: 0.3, noNaN: true }),
        fc.double({ min: 0.001, max: 0.2, noNaN: true }),
        methodArb,
        fc.boolean(),
        (cfs, tv, w, bump, terminalMethod, midYear) => {
          const ev = (rate: number) =>
            dcfValuation({ cashflows: cfs, wacc: rate, terminalValue: tv, terminalMethod, midYear }).value
              .enterpriseValue;
          expect(ev(w + bump)).toBeLessThan(ev(w));
        },
      ),
    );
  });

  it("property: higher WACC → lower EV (Gordon TV rebuilt at each WACC)", () => {
    fc.assert(
      fc.property(
        positiveCashflows,
        fc.double({ min: 0.05, max: 0.3, noNaN: true }),
        fc.double({ min: 0.001, max: 0.2, noNaN: true }),
        fc.double({ min: -0.02, max: 0.04, noNaN: true }),
        fc.boolean(),
        (cfs, w, bump, g, midYear) => {
          const fcfN = cfs[cfs.length - 1] ?? 0;
          const ev = (rate: number) =>
            dcfValuation({
              cashflows: cfs,
              wacc: rate,
              terminalValue: gordonGrowthTerminalValue({ finalYearFcf: fcfN, wacc: rate, growthRate: g })
                .value,
              terminalMethod: "gordon",
              midYear,
            }).value.enterpriseValue;
          expect(ev(w + bump)).toBeLessThan(ev(w));
        },
      ),
    );
  });

  it("property: mid-year EV > end-year EV for positive cashflows and WACC > 0", () => {
    fc.assert(
      fc.property(
        positiveCashflows,
        fc.double({ min: 0, max: 1e7, noNaN: true }),
        fc.double({ min: 0.01, max: 0.3, noNaN: true }),
        methodArb,
        (cfs, tv, w, terminalMethod) => {
          const end = dcfValuation({ cashflows: cfs, wacc: w, terminalValue: tv, terminalMethod }).value;
          const mid = dcfValuation({
            cashflows: cfs,
            wacc: w,
            terminalValue: tv,
            terminalMethod,
            midYear: true,
          }).value;
          expect(mid.enterpriseValue).toBeGreaterThan(end.enterpriseValue);
          // Exit-multiple TV stays at N; Gordon TV moves to N − 0.5, i.e. scales by √(1 + WACC).
          const factor = terminalMethod === "gordon" ? Math.sqrt(1 + w) : 1;
          expect(relClose(mid.pvOfTerminal, end.pvOfTerminal * factor)).toBe(true);
        },
      ),
    );
  });

  it("property: mid-year PV = end-year PV × √(1 + r)", () => {
    fc.assert(
      fc.property(positiveCashflows, fc.double({ min: 0, max: 0.5, noNaN: true }), (cfs, r) => {
        const end = presentValue(cfs, r).value;
        const mid = presentValue(cfs, r, { midYear: true }).value;
        expect(relClose(mid, end * Math.sqrt(1 + r))).toBe(true);
      }),
    );
  });
});
