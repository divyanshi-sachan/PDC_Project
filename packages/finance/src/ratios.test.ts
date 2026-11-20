import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FinanceInputError } from "./errors.ts";
import {
  cashConversionCycle,
  currentRatio,
  daysInventoryOutstanding,
  daysPayablesOutstanding,
  daysSalesOutstanding,
  debtToEquity,
  ebitdaMargin,
  ebitMargin,
  fcfConversion,
  grossMargin,
  interestCoverage,
  netDebtToEbitda,
  netMargin,
  quickRatio,
  returnOnAssets,
  returnOnEquity,
  returnOnInvestedCapital,
} from "./ratios.ts";

describe("margins", () => {
  it("hand-computed margins on revenue 1000", () => {
    // 400 / 1000 = 0.4
    const g = grossMargin({ grossProfit: 400, revenue: 1000 });
    expect(g.value).toBeCloseTo(0.4, 9);
    expect(g.unit).toBe("ratio");
    expect(g.formulaId).toBe("ratios.gross_margin");
    // 150 / 1000 = 0.15
    expect(ebitMargin({ ebit: 150, revenue: 1000 }).value).toBeCloseTo(0.15, 9);
    // 220 / 1000 = 0.22
    expect(ebitdaMargin({ ebitda: 220, revenue: 1000 }).value).toBeCloseTo(0.22, 9);
    // -30 / 1000 = -0.03 (loss-making is allowed)
    expect(netMargin({ netIncome: -30, revenue: 1000 }).value).toBeCloseTo(-0.03, 9);
  });

  it("throws on revenue ≤ 0 or non-finite input", () => {
    expect(() => grossMargin({ grossProfit: 1, revenue: 0 })).toThrow(FinanceInputError);
    expect(() => ebitMargin({ ebit: 1, revenue: -5 })).toThrow(FinanceInputError);
    expect(() => ebitdaMargin({ ebitda: Number.NaN, revenue: 5 })).toThrow(FinanceInputError);
    expect(() => netMargin({ netIncome: 1, revenue: Number.POSITIVE_INFINITY })).toThrow(FinanceInputError);
  });

  it("property: margin × revenue recovers the numerator", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.double({ min: 1e-3, max: 1e9, noNaN: true }),
        (num, rev) => {
          const m = ebitMargin({ ebit: num, revenue: rev }).value;
          expect(m * rev).toBeCloseTo(num, 6);
        },
      ),
    );
  });
});

describe("returns", () => {
  it("hand-computed ROE / ROA / ROIC", () => {
    // 120 / 800 = 0.15
    expect(returnOnEquity({ netIncome: 120, shareholdersEquity: 800 }).value).toBeCloseTo(0.15, 9);
    // 120 / 2000 = 0.06
    expect(returnOnAssets({ netIncome: 120, totalAssets: 2000 }).value).toBeCloseTo(0.06, 9);
    // NOPAT = 200·(1 − 0.25) = 150; 150 / 1250 = 0.12
    expect(returnOnInvestedCapital({ nopat: 150, investedCapital: 1250 }).value).toBeCloseTo(0.12, 9);
  });
  it("throws on non-positive denominators", () => {
    expect(() => returnOnEquity({ netIncome: 1, shareholdersEquity: -100 })).toThrow(FinanceInputError);
    expect(() => returnOnAssets({ netIncome: 1, totalAssets: 0 })).toThrow(FinanceInputError);
    expect(() => returnOnInvestedCapital({ nopat: 1, investedCapital: 0 })).toThrow(FinanceInputError);
  });
});

describe("liquidity and leverage", () => {
  it("hand-computed current / quick ratios", () => {
    // 300 / 200 = 1.5
    expect(currentRatio({ currentAssets: 300, currentLiabilities: 200 }).value).toBeCloseTo(1.5, 9);
    // (50 + 25 + 75) / 200 = 150 / 200 = 0.75
    expect(
      quickRatio({ cash: 50, shortTermInvestments: 25, receivables: 75, currentLiabilities: 200 }).value,
    ).toBeCloseTo(0.75, 9);
  });
  it("hand-computed D/E, net debt / EBITDA, coverage", () => {
    // 400 / 800 = 0.5
    expect(debtToEquity({ totalDebt: 400, shareholdersEquity: 800 }).value).toBeCloseTo(0.5, 9);
    // (400 − 100) / 150 = 2.0
    expect(netDebtToEbitda({ totalDebt: 400, cash: 100, ebitda: 150 }).value).toBeCloseTo(2, 9);
    // net cash: (100 − 400) / 150 = −2.0
    expect(netDebtToEbitda({ totalDebt: 100, cash: 400, ebitda: 150 }).value).toBeCloseTo(-2, 9);
    // 150 / 40 = 3.75
    expect(interestCoverage({ ebit: 150, interestExpense: 40 }).value).toBeCloseTo(3.75, 9);
  });
  it("throws on invalid inputs", () => {
    expect(() => currentRatio({ currentAssets: 1, currentLiabilities: 0 })).toThrow(FinanceInputError);
    expect(() => currentRatio({ currentAssets: -1, currentLiabilities: 1 })).toThrow(FinanceInputError);
    expect(() =>
      quickRatio({ cash: -1, shortTermInvestments: 0, receivables: 0, currentLiabilities: 1 }),
    ).toThrow(FinanceInputError);
    expect(() => debtToEquity({ totalDebt: 1, shareholdersEquity: 0 })).toThrow(FinanceInputError);
    expect(() => debtToEquity({ totalDebt: -1, shareholdersEquity: 1 })).toThrow(FinanceInputError);
    expect(() => netDebtToEbitda({ totalDebt: 1, cash: 0, ebitda: -10 })).toThrow(FinanceInputError);
    expect(() => interestCoverage({ ebit: 10, interestExpense: 0 })).toThrow(FinanceInputError);
  });
});

describe("working capital days", () => {
  it("hand-computed DSO / DIO / DPO / CCC with 365 days", () => {
    // DSO = 100 / 1000 × 365 = 36.5
    expect(daysSalesOutstanding({ receivables: 100, revenue: 1000 }).value).toBeCloseTo(36.5, 9);
    // DIO = 60 / 600 × 365 = 36.5
    expect(daysInventoryOutstanding({ inventory: 60, cogs: 600 }).value).toBeCloseTo(36.5, 9);
    // DPO = 30 / 600 × 365 = 18.25
    expect(daysPayablesOutstanding({ payables: 30, cogs: 600 }).value).toBeCloseTo(18.25, 9);
    // CCC = 36.5 + 36.5 − 18.25 = 54.75
    const ccc = cashConversionCycle({
      receivables: 100,
      inventory: 60,
      payables: 30,
      revenue: 1000,
      cogs: 600,
    });
    expect(ccc.value).toBeCloseTo(54.75, 9);
    expect(ccc.unit).toBe("days");
    expect(ccc.inputs.days).toBe(365);
  });
  it("respects a custom days param (360-day year)", () => {
    // 100 / 1000 × 360 = 36
    expect(daysSalesOutstanding({ receivables: 100, revenue: 1000, days: 360 }).value).toBeCloseTo(36, 9);
    // CCC(360) = 36 + 36 − 18 = 54
    expect(
      cashConversionCycle({
        receivables: 100,
        inventory: 60,
        payables: 30,
        revenue: 1000,
        cogs: 600,
        days: 360,
      }).value,
    ).toBeCloseTo(54, 9);
  });
  it("throws on invalid denominators, days and negative balances", () => {
    expect(() => daysSalesOutstanding({ receivables: 1, revenue: 0 })).toThrow(FinanceInputError);
    expect(() => daysSalesOutstanding({ receivables: 1, revenue: 1, days: 0 })).toThrow(FinanceInputError);
    expect(() => daysInventoryOutstanding({ inventory: -1, cogs: 1 })).toThrow(FinanceInputError);
    expect(() => daysPayablesOutstanding({ payables: 1, cogs: 0 })).toThrow(FinanceInputError);
    expect(() =>
      cashConversionCycle({ receivables: 1, inventory: 1, payables: 1, revenue: 1, cogs: -1 }),
    ).toThrow(FinanceInputError);
  });
  it("property: CCC = DSO + DIO − DPO", () => {
    const pos = fc.double({ min: 1, max: 1e6, noNaN: true });
    const bal = fc.double({ min: 0, max: 1e6, noNaN: true });
    fc.assert(
      fc.property(bal, bal, bal, pos, pos, (ar, inv, ap, rev, cogs) => {
        const ccc = cashConversionCycle({
          receivables: ar,
          inventory: inv,
          payables: ap,
          revenue: rev,
          cogs,
        });
        const expected =
          daysSalesOutstanding({ receivables: ar, revenue: rev }).value +
          daysInventoryOutstanding({ inventory: inv, cogs }).value -
          daysPayablesOutstanding({ payables: ap, cogs }).value;
        expect(ccc.value).toBeCloseTo(expected, 6);
      }),
    );
  });
});

describe("fcfConversion", () => {
  it("hand-computed: 90 / 120 = 0.75", () => {
    expect(fcfConversion({ freeCashFlow: 90, netIncome: 120 }).value).toBeCloseTo(0.75, 9);
  });
  it("throws when net income ≤ 0", () => {
    expect(() => fcfConversion({ freeCashFlow: 90, netIncome: 0 })).toThrow(FinanceInputError);
    expect(() => fcfConversion({ freeCashFlow: 90, netIncome: -5 })).toThrow(FinanceInputError);
  });
});
