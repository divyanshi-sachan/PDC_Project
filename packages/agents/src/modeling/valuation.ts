import {
  axisAround,
  type CalcResult,
  costOfEquityCapm,
  dcfValuation,
  discountFactors,
  enterpriseToEquity,
  gordonGrowthTerminalValue,
  growthRate,
  nwcChange,
  perShareValue,
  projectByRatio,
  projectGrowth,
  sensitivityGrid,
  ufcf,
  wacc as waccFormula,
} from "@dealpilot/finance";
import type { AssumptionSet } from "./assumptions.ts";
import { HORIZON_YEARS } from "./assumptions.ts";
import type { HistorySummary } from "./summary.ts";

export interface MarketInputs {
  price: number;
  marketCap: number;
  /** Levered equity beta (FMP profile). */
  beta: number;
  /** 10-year Treasury par yield as a decimal. */
  riskFreeRate: number;
}

export interface ValuationInput {
  summary: HistorySummary;
  market: MarketInputs;
  assumptions: AssumptionSet;
  /** Override the computed WACC (e.g. the user asked "use 9% WACC"). */
  waccOverride?: number;
}

export interface ProjectionYear {
  /** 1-based projection year. */
  index: number;
  revenue: number;
  ebit: number;
  ufcf: number;
  discountFactor: number;
}

export interface ValuationOutput {
  projection: ProjectionYear[];
  costOfEquity: number;
  wacc: number;
  waccSource: "computed" | "override";
  terminalValue: number;
  pvOfCashflows: number;
  pvOfTerminal: number;
  terminalShareOfEv: number | null;
  enterpriseValue: number;
  equityValue: number;
  perShare: number;
  /** perShare / price − 1, or null when the price is not positive. */
  upsideVsPrice: number | null;
  sensitivity: { rows: number[]; cols: number[]; values: number[][] };
  /** Formula ids of every finance function used. */
  formulaIds: string[];
}

/** Thrown when inputs make the DCF mathematically meaningless (e.g. WACC ≤ terminal growth). */
export class ValuationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValuationError";
  }
}

/**
 * 5-year unlevered DCF with Gordon-growth terminal value. Every figure is produced by `@dealpilot/finance`;
 * this function only wires inputs to those formulas and records which ones ran.
 */
export function runValuation(i: ValuationInput): ValuationOutput {
  const { summary: s, market: m, assumptions: a } = i;
  const used = new Set<string>();
  const track = <T>(r: CalcResult<T>): T => {
    used.add(r.formulaId);
    return r.value;
  };

  // Operating projection
  const revenues = track(projectGrowth({ base: s.latestRevenue, growthRates: a.revenueGrowth }));
  const ebits = track(projectByRatio({ drivers: revenues, ratios: a.ebitMargin }));
  const das = track(projectByRatio({ drivers: revenues, ratios: revenues.map(() => a.daPctRevenue) }));
  const capexes = track(projectByRatio({ drivers: revenues, ratios: revenues.map(() => a.capexPctRevenue) }));
  const dNwc = track(
    nwcChange({ nwcRatio: a.nwcPctOfRevenueChange, revenues, baseRevenue: s.latestRevenue }),
  );
  const fcfs = revenues.map((_, k) =>
    track(
      ufcf({
        ebit: ebits[k] as number,
        taxRate: a.taxRate,
        depreciationAndAmortization: das[k] as number,
        capex: capexes[k] as number,
        changeInNwc: dNwc[k] as number,
      }),
    ),
  );

  // Discount rate
  const costOfEquity = track(
    costOfEquityCapm({ riskFreeRate: m.riskFreeRate, beta: m.beta, equityRiskPremium: a.equityRiskPremium }),
  );
  const computedWacc = track(
    waccFormula({
      equityValue: m.marketCap,
      debtValue: s.totalDebt,
      costOfEquity,
      preTaxCostOfDebt: a.preTaxCostOfDebt,
      taxRate: a.taxRate,
    }),
  );
  const discountRate = i.waccOverride ?? computedWacc;
  if (discountRate <= a.terminalGrowth) {
    throw new ValuationError(
      `Discount rate ${(discountRate * 100).toFixed(2)}% must exceed terminal growth ${(a.terminalGrowth * 100).toFixed(2)}%.`,
    );
  }

  // Value
  const lastFcf = fcfs[fcfs.length - 1] as number;
  if (lastFcf <= 0) {
    throw new ValuationError(
      "Final-year free cash flow is not positive, so a perpetuity-growth terminal value is not meaningful.",
    );
  }
  const tv = track(
    gordonGrowthTerminalValue({ finalYearFcf: lastFcf, wacc: discountRate, growthRate: a.terminalGrowth }),
  );
  const dcf = track(
    dcfValuation({ cashflows: fcfs, wacc: discountRate, terminalValue: tv, terminalMethod: "gordon" }),
  );
  const bridgeItems = {
    debt: s.totalDebt,
    preferred: 0,
    minorityInterest: 0,
    cash: s.cashAndInvestments,
    nonOperatingAssets: 0,
  };
  const bridge = track(enterpriseToEquity({ enterpriseValue: dcf.enterpriseValue, ...bridgeItems }));
  const perShare = track(perShareValue({ equityValue: bridge.equityValue, dilutedShares: s.dilutedShares }));
  const upside = m.price > 0 ? track(growthRate({ previous: m.price, current: perShare })) : null;
  const dfs = track(discountFactors(discountRate, HORIZON_YEARS));

  // Sensitivity: value per share across WACC × terminal growth.
  const stepG = 0.005;
  const room = discountRate - a.terminalGrowth - 2 * stepG;
  if (room <= 0) throw new ValuationError("WACC is too close to terminal growth for a sensitivity table.");
  const stepW = Math.min(0.01, room / 2.5);
  const waccAxis = track(axisAround({ center: discountRate, step: stepW, count: 5 }));
  const growthAxis = track(axisAround({ center: a.terminalGrowth, step: stepG, count: 5 }));
  const grid = track(
    sensitivityGrid(
      waccAxis,
      growthAxis,
      (w, g) => {
        const t = gordonGrowthTerminalValue({ finalYearFcf: lastFcf, wacc: w, growthRate: g }).value;
        const ev = dcfValuation({ cashflows: fcfs, wacc: w, terminalValue: t, terminalMethod: "gordon" })
          .value.enterpriseValue;
        const eq = enterpriseToEquity({ enterpriseValue: ev, ...bridgeItems }).value.equityValue;
        return perShareValue({ equityValue: eq, dilutedShares: s.dilutedShares }).value;
      },
      {
        unit: "currency_per_share",
        formulaId: "sensitivity.wacc_growth_per_share",
        inputs: { fcfs, bridgeItems, shares: s.dilutedShares },
      },
    ),
  );

  return {
    projection: revenues.map((revenue, k) => ({
      index: k + 1,
      revenue,
      ebit: ebits[k] as number,
      ufcf: fcfs[k] as number,
      discountFactor: dfs[k] as number,
    })),
    costOfEquity,
    wacc: discountRate,
    waccSource: i.waccOverride === undefined ? "computed" : "override",
    terminalValue: tv,
    pvOfCashflows: dcf.pvOfCashflows,
    pvOfTerminal: dcf.pvOfTerminal,
    terminalShareOfEv: dcf.terminalShareOfEV,
    enterpriseValue: dcf.enterpriseValue,
    equityValue: bridge.equityValue,
    perShare,
    upsideVsPrice: upside,
    sensitivity: { rows: grid.rows, cols: grid.cols, values: grid.values },
    formulaIds: [...used].sort(),
  };
}
