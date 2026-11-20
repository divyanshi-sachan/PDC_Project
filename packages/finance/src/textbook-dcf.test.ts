/**
 * End-to-end textbook DCF: 5-year projection → UFCF → WACC → Gordon TV → EV → equity → diluted per-share.
 * Everything goes through the public index, as an agent would call it.
 */
import { describe, expect, it } from "vitest";
import {
  costOfEquityCapm,
  dcfValuation,
  enterpriseToEquity,
  gordonGrowthTerminalValue,
  impliedExitMultiple,
  perShareValue,
  solveDilutedShares,
  ufcf,
  wacc,
} from "./index.ts";
import { expectRelClose } from "./test-utils.ts";

describe("textbook 5-year DCF", () => {
  // --- Projections (FY1..FY5, currency: $mm) --------------------------------------------------
  // EBIT          100   110   120   130   140
  // tax 20%  →  NOPAT 80    88    96    104   112
  // + D&A          20    20    20    20    20
  // − capex        30    30    30    30    30
  // − ΔNWC          5     5     5     5     5
  // = UFCF         65    73    81    89    97      (NOPAT − 15)
  const ebit = [100, 110, 120, 130, 140];
  const cashflows = ebit.map(
    (e) => ufcf({ ebit: e, taxRate: 0.2, depreciationAndAmortization: 20, capex: 30, changeInNwc: 5 }).value,
  );

  // --- WACC -----------------------------------------------------------------------------------
  // ke = 4.25% + 1.4·5% = 11.25%
  // kd after tax = 6.25%·(1 − 20%) = 5%
  // E = 800, D = 200 → weights 80% / 20%
  // WACC = 0.8·11.25% + 0.2·5% = 9% + 1% = 10%
  const ke = costOfEquityCapm({ riskFreeRate: 0.0425, beta: 1.4, equityRiskPremium: 0.05 }).value;
  const w = wacc({
    equityValue: 800,
    debtValue: 200,
    costOfEquity: ke,
    preTaxCostOfDebt: 0.0625,
    taxRate: 0.2,
  }).value;

  // --- Terminal value (Gordon, g = 2%) ---------------------------------------------------------
  // TV_5 = 97·1.02 / (0.10 − 0.02) = 98.94 / 0.08 = 1236.75
  const tv = gordonGrowthTerminalValue({ finalYearFcf: 97, wacc: w, growthRate: 0.02 }).value;

  it("builds the UFCF line, WACC and TV", () => {
    [65, 73, 81, 89, 97].forEach((expected, t) => {
      expect(cashflows[t]).toBeCloseTo(expected, 9);
    });
    expect(ke).toBeCloseTo(0.1125, 9);
    expect(w).toBeCloseTo(0.1, 9);
    expect(tv).toBeCloseTo(1236.75, 9);
  });

  it("values the business (end-year convention)", () => {
    // PV of UFCF at 10%:
    //   65 / 1.1      =  59.0909090909
    //   73 / 1.21     =  60.3305785124
    //   81 / 1.331    =  60.8564988730
    //   89 / 1.4641   =  60.7881975275
    //   97 / 1.61051  =  60.2293683367
    //   Σ             = 301.2955523405
    // PV of TV = 1236.75 / 1.61051 = 767.9244462934
    // EV = 301.2955523405 + 767.9244462934 = 1069.2199986340
    // TV share = 767.9244462934 / 1069.2199986340 = 0.7182099542
    const v = dcfValuation({ cashflows, wacc: w, terminalValue: tv, terminalMethod: "gordon" }).value;
    expectRelClose(v.pvOfCashflows, 301.2955523405629);
    expectRelClose(v.pvOfTerminal, 767.9244462934099);
    expectRelClose(v.enterpriseValue, 1069.2199986339729);
    expectRelClose(v.terminalShareOfEV ?? Number.NaN, 0.7182099542418812);

    // Cross-check against the direct formula.
    const direct =
      65 / 1.1 + 73 / 1.1 ** 2 + 81 / 1.1 ** 3 + 89 / 1.1 ** 4 + 97 / 1.1 ** 5 + 1236.75 / 1.1 ** 5;
    expectRelClose(v.enterpriseValue, direct);

    // Implied exit multiple on FY5 EBITDA (140 + 20 = 160): 1236.75 / 160 = 7.7296875x
    expect(
      impliedExitMultiple({ finalYearFcf: 97, finalYearMetric: 160, wacc: w, growthRate: 0.02 }).value,
    ).toBeCloseTo(7.7296875, 9);
  });

  it("mid-year Gordon: cashflows at t − 0.5 and the Gordon TV at N − 0.5 = 4.5", () => {
    // PV(CF) mid-year = 301.2955523405629 × √1.1 = 301.2955523405629 × 1.0488088482 = 316.0014412091
    // PV(TV) = 1236.75 / 1.1^4.5 = 1236.75 / 1.5355610346 = 805.4059539987
    //        (= 767.9244462934 × √1.1)
    // EV = 316.0014412091 + 805.4059539987 = 1121.4073952078
    // TV share is unchanged (both terms scale by √1.1): 0.7182099542
    const v = dcfValuation({
      cashflows,
      wacc: w,
      terminalValue: tv,
      terminalMethod: "gordon",
      midYear: true,
    }).value;
    expectRelClose(v.pvOfCashflows, 316.00144120909533);
    expectRelClose(v.pvOfTerminal, 1236.75 / 1.1 ** 4.5);
    expectRelClose(v.pvOfTerminal, 805.4059539986927);
    expectRelClose(v.enterpriseValue, 1121.4073952077879);
    expectRelClose(v.terminalShareOfEV ?? Number.NaN, 0.7182099542418812);
  });

  it("mid-year exit multiple: same TV of 1236.75 stays at full N = 5", () => {
    // EV = 316.0014412091 + 1236.75 / 1.61051 = 316.0014412091 + 767.9244462934 = 1083.9258875025
    const v = dcfValuation({
      cashflows,
      wacc: w,
      terminalValue: tv,
      terminalMethod: "exitMultiple",
      midYear: true,
    }).value;
    expectRelClose(v.pvOfTerminal, 767.9244462934099);
    expectRelClose(v.enterpriseValue, 1083.9258875025052);
  });

  it("bridges to a diluted value per share", () => {
    // Equity = 1069.2199986340 − debt 200 − preferred 0 − minority 10 + cash 50 + non-op 0 = 909.2199986340
    const ev = dcfValuation({ cashflows, wacc: w, terminalValue: tv, terminalMethod: "gordon" }).value
      .enterpriseValue;
    const bridge = enterpriseToEquity({
      enterpriseValue: ev,
      debt: 200,
      preferred: 0,
      minorityInterest: 10,
      cash: 50,
      nonOperatingAssets: 0,
    }).value;
    expectRelClose(bridge.equityValue, 909.2199986339729);

    // Basic shares 100mm; 5mm options @ $6 and 2mm RSUs. Both tranches end up in the money, so the
    // circular TSM has the closed form P = (E + Σ count·strike) / (basic + Σ count)
    //   = (909.2199986340 + 5·6 + 2·0) / (100 + 5 + 2) = 939.2199986340 / 107 = 8.7777569966
    // Diluted shares = 909.2199986340 / 8.7777569966 = 103.5822703896
    //   (= 100 + 5·(1 − 6/8.7777569966) + 2 = 100 + 1.5822703896 + 2)
    const sol = solveDilutedShares({
      equityValue: bridge.equityValue,
      basicShares: 100,
      instruments: [
        { label: "options", count: 5, strike: 6 },
        { label: "rsus", count: 2, strike: 0 },
      ],
    }).value;
    expectRelClose(sol.sharePrice, 939.2199986339729 / 107);
    expectRelClose(sol.dilutedShares, 103.58227038961189);

    const perShare = perShareValue({
      equityValue: bridge.equityValue,
      dilutedShares: sol.dilutedShares,
    }).value;
    expectRelClose(perShare, 8.777756996579186);
  });
});
