import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FinanceInputError } from "./errors.ts";
import { afterTaxCostOfDebt, costOfEquityCapm, releverBeta, unleverBeta, wacc } from "./wacc.ts";

describe("costOfEquityCapm", () => {
  it("hand-computed: 4% + 1.2·5% = 10%", () => {
    const r = costOfEquityCapm({ riskFreeRate: 0.04, beta: 1.2, equityRiskPremium: 0.05 });
    expect(r.value).toBeCloseTo(0.1, 9);
    expect(r.unit).toBe("rate");
    expect(r.inputs.sizePremium).toBe(0);
  });
  it("adds a size premium: 4% + 1.2·5% + 2% = 12%", () => {
    expect(
      costOfEquityCapm({ riskFreeRate: 0.04, beta: 1.2, equityRiskPremium: 0.05, sizePremium: 0.02 }).value,
    ).toBeCloseTo(0.12, 9);
  });
  it("throws on non-finite input", () => {
    expect(() => costOfEquityCapm({ riskFreeRate: Number.NaN, beta: 1, equityRiskPremium: 0.05 })).toThrow(
      FinanceInputError,
    );
  });
});

describe("afterTaxCostOfDebt", () => {
  it("hand-computed: 6%·(1 − 25%) = 4.5%", () => {
    expect(afterTaxCostOfDebt({ preTaxCostOfDebt: 0.06, taxRate: 0.25 }).value).toBeCloseTo(0.045, 9);
  });
  it("throws on a tax rate outside [0, 1]", () => {
    expect(() => afterTaxCostOfDebt({ preTaxCostOfDebt: 0.06, taxRate: 1.5 })).toThrow(FinanceInputError);
    expect(() => afterTaxCostOfDebt({ preTaxCostOfDebt: 0.06, taxRate: -0.1 })).toThrow(FinanceInputError);
  });
});

describe("wacc", () => {
  it("hand-computed with market-value weights", () => {
    // E = 600, D = 400 → weights 0.6 / 0.4
    // kd after tax = 8%·(1 − 25%) = 6%
    // WACC = 0.6·12% + 0.4·6% = 7.2% + 2.4% = 9.6%
    const r = wacc({
      equityValue: 600,
      debtValue: 400,
      costOfEquity: 0.12,
      preTaxCostOfDebt: 0.08,
      taxRate: 0.25,
    });
    expect(r.value).toBeCloseTo(0.096, 9);
    expect(r.inputs.equityWeight).toBeCloseTo(0.6, 9);
    expect(r.inputs.debtWeight).toBeCloseTo(0.4, 9);
    expect(r.formulaId).toBe("wacc.wacc");
  });
  it("all-equity company: WACC = ke", () => {
    expect(
      wacc({ equityValue: 100, debtValue: 0, costOfEquity: 0.11, preTaxCostOfDebt: 0.05, taxRate: 0.2 })
        .value,
    ).toBeCloseTo(0.11, 9);
  });
  it("throws on E ≤ 0, D < 0 and a bad tax rate", () => {
    const base = { equityValue: 100, debtValue: 50, costOfEquity: 0.1, preTaxCostOfDebt: 0.05, taxRate: 0.2 };
    expect(() => wacc({ ...base, equityValue: 0 })).toThrow(FinanceInputError);
    expect(() => wacc({ ...base, debtValue: -1 })).toThrow(FinanceInputError);
    expect(() => wacc({ ...base, taxRate: 2 })).toThrow(FinanceInputError);
  });
  it("property: WACC lies between after-tax kd and ke", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1e6, noNaN: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        fc.double({ min: 0, max: 0.3, noNaN: true }),
        fc.double({ min: 0, max: 0.2, noNaN: true }),
        fc.double({ min: 0, max: 0.5, noNaN: true }),
        (e, d, ke, kd, t) => {
          const w = wacc({
            equityValue: e,
            debtValue: d,
            costOfEquity: ke,
            preTaxCostOfDebt: kd,
            taxRate: t,
          }).value;
          const lo = Math.min(ke, kd * (1 - t));
          const hi = Math.max(ke, kd * (1 - t));
          expect(w).toBeGreaterThanOrEqual(lo - 1e-12);
          expect(w).toBeLessThanOrEqual(hi + 1e-12);
        },
      ),
    );
  });
});

describe("Hamada beta", () => {
  it("hand-computed unlever: 1.3 / (1 + 0.75·0.4) = 1.3 / 1.3 = 1.0", () => {
    expect(unleverBeta({ leveredBeta: 1.3, debtToEquity: 0.4, taxRate: 0.25 }).value).toBeCloseTo(1, 9);
  });
  it("hand-computed relever: 1.0·(1 + 0.8·0.5) = 1.4", () => {
    expect(releverBeta({ unleveredBeta: 1, debtToEquity: 0.5, taxRate: 0.2 }).value).toBeCloseTo(1.4, 9);
  });
  it("throws on negative D/E or bad tax rate", () => {
    expect(() => unleverBeta({ leveredBeta: 1, debtToEquity: -0.1, taxRate: 0.2 })).toThrow(
      FinanceInputError,
    );
    expect(() => releverBeta({ unleveredBeta: 1, debtToEquity: 0.5, taxRate: 1.2 })).toThrow(
      FinanceInputError,
    );
  });
  it("property: relever(unlever(β)) = β", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: 0, max: 5, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (beta, de, t) => {
          const bu = unleverBeta({ leveredBeta: beta, debtToEquity: de, taxRate: t }).value;
          expect(releverBeta({ unleveredBeta: bu, debtToEquity: de, taxRate: t }).value).toBeCloseTo(beta, 9);
        },
      ),
    );
  });
});
