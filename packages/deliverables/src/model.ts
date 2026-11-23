/**
 * Cached values for the workbook's formula cells. Excel recomputes the formulas on open; the cached results let
 * viewers that do not recalculate (previewers, parsers) show the right numbers. They come from `@dealpilot/finance`.
 */
import {
  costOfEquityCapm,
  nwcChange,
  projectByRatio,
  projectGrowth,
  ufcf,
  wacc as waccFormula,
} from "@dealpilot/finance";
import type { Panel } from "@dealpilot/shared";

export class WorkbookInputError extends Error {}

export interface Series {
  growth: number[];
  margins: number[];
}

export function assumptionValue(panel: Panel, key: string): number {
  const a = panel.assumptions.find((x) => x.key === key);
  if (!a) throw new WorkbookInputError(`assumption "${key}" is missing from the panel`);
  return a.value;
}

export function readSeries(panel: Panel): Series {
  const read = (prefix: string) => {
    const out: number[] = [];
    for (let k = 1; panel.assumptions.some((a) => a.key === `${prefix}${k}`); k++)
      out.push(assumptionValue(panel, `${prefix}${k}`));
    return out;
  };
  const growth = read("revenue_growth_y");
  const margins = read("ebit_margin_y");
  if (growth.length === 0 || growth.length !== margins.length)
    throw new WorkbookInputError("growth and margin paths are missing or differ in length");
  return { growth, margins };
}

export interface Derived {
  revenues: number[];
  ebits: number[];
  taxes: number[];
  nopat: number[];
  das: number[];
  capexes: number[];
  dNwc: number[];
  fcfs: number[];
  costOfEquity: number;
  waccComputed: number;
}

export function derive(panel: Panel): Derived {
  const { growth, margins } = readSeries(panel);
  const v = (k: string) => assumptionValue(panel, k);
  const tax = v("tax_rate");
  const revenues = projectGrowth({ base: v("revenue_base"), growthRates: growth }).value;
  const ebits = projectByRatio({ drivers: revenues, ratios: margins }).value;
  const das = projectByRatio({ drivers: revenues, ratios: revenues.map(() => v("da_pct")) }).value;
  const capexes = projectByRatio({ drivers: revenues, ratios: revenues.map(() => v("capex_pct")) }).value;
  const dNwc = nwcChange({ nwcRatio: v("nwc_pct"), revenues, baseRevenue: v("revenue_base") }).value;
  const fcfs = revenues.map(
    (_, k) =>
      ufcf({
        ebit: ebits[k] as number,
        taxRate: tax,
        depreciationAndAmortization: das[k] as number,
        capex: capexes[k] as number,
        changeInNwc: dNwc[k] as number,
      }).value,
  );
  const costOfEquity = costOfEquityCapm({
    riskFreeRate: v("risk_free"),
    beta: v("beta"),
    equityRiskPremium: v("erp"),
  }).value;
  const waccComputed = waccFormula({
    equityValue: v("market_cap"),
    debtValue: v("total_debt"),
    costOfEquity,
    preTaxCostOfDebt: v("pretax_cost_of_debt"),
    taxRate: tax,
  }).value;
  return {
    revenues,
    ebits,
    taxes: ebits.map((e) => e * tax),
    nopat: ebits.map((e) => e * (1 - tax)),
    das,
    capexes,
    dNwc,
    fcfs,
    costOfEquity,
    waccComputed,
  };
}
