/**
 * Independent recomputation of the valuation from the DELIVERABLE ONLY (the panel's assumptions table).
 *
 * The Verifier does not import or call `runValuation`, `computePanel` or anything from the modeling agent: it wires
 * `@dealpilot/finance` itself, from the numbers a reader sees. If the modeling code ever produced a figure that is
 * not implied by the stated assumptions (a wiring bug, a stale value, a tampered number), the recomputation disagrees.
 */
import {
  costOfEquityCapm,
  dcfValuation,
  discountFactors,
  enterpriseToEquity,
  gordonGrowthTerminalValue,
  nwcChange,
  perShareValue,
  projectByRatio,
  projectGrowth,
  ufcf,
  wacc as waccFormula,
} from "@dealpilot/finance";
import type { Defect, Panel } from "@dealpilot/shared";

export interface Recomputed {
  revenues: number[];
  ebits: number[];
  fcfs: number[];
  discountFactors: number[];
  costOfEquity: number;
  wacc: number;
  terminalValue: number;
  pvOfTerminal: number;
  enterpriseValue: number;
  equityValue: number;
  perShare: number;
  terminalShareOfEv: number | null;
  /** values[r][c] for the panel's own sensitivity axes (rows = WACC, cols = terminal growth). */
  grid: number[][];
}

export class MissingInputError extends Error {}

/** Relative closeness with an absolute floor near zero. */
export const close = (a: number, b: number, rel = 1e-9): boolean =>
  Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));

function assumptionMap(panel: Panel): Map<string, number> {
  return new Map(panel.assumptions.map((a) => [a.key, a.value]));
}

function need(m: Map<string, number>, key: string): number {
  const v = m.get(key);
  if (v === undefined) throw new MissingInputError(`assumption "${key}" is not in the deliverable`);
  return v;
}

function series(m: Map<string, number>, prefix: string): number[] {
  const out: number[] = [];
  for (let k = 1; m.has(`${prefix}${k}`); k++) out.push(m.get(`${prefix}${k}`) as number);
  if (out.length === 0) throw new MissingInputError(`no "${prefix}*" assumptions in the deliverable`);
  return out;
}

export function recomputeValuation(panel: Panel): Recomputed {
  const m = assumptionMap(panel);
  const growth = series(m, "revenue_growth_y");
  const margins = series(m, "ebit_margin_y");
  if (growth.length !== margins.length)
    throw new MissingInputError("growth and margin paths differ in length");

  const base = need(m, "revenue_base");
  const tax = need(m, "tax_rate");
  const da = need(m, "da_pct");
  const capex = need(m, "capex_pct");
  const nwc = need(m, "nwc_pct");
  const g = need(m, "terminal_growth");
  const debt = need(m, "total_debt");
  const cash = need(m, "cash");
  const shares = need(m, "diluted_shares");

  const revenues = projectGrowth({ base, growthRates: growth }).value;
  const ebits = projectByRatio({ drivers: revenues, ratios: margins }).value;
  const das = projectByRatio({ drivers: revenues, ratios: revenues.map(() => da) }).value;
  const capexes = projectByRatio({ drivers: revenues, ratios: revenues.map(() => capex) }).value;
  const dNwc = nwcChange({ nwcRatio: nwc, revenues, baseRevenue: base }).value;
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

  const ke = costOfEquityCapm({
    riskFreeRate: need(m, "risk_free"),
    beta: need(m, "beta"),
    equityRiskPremium: need(m, "erp"),
  }).value;
  const computedWacc = waccFormula({
    equityValue: need(m, "market_cap"),
    debtValue: debt,
    costOfEquity: ke,
    preTaxCostOfDebt: need(m, "pretax_cost_of_debt"),
    taxRate: tax,
  }).value;
  const rate = m.get("wacc") ?? computedWacc; // a "wacc" row exists only when the user overrode it

  const lastFcf = fcfs[fcfs.length - 1] as number;
  const evAt = (w: number, tg: number) => {
    const tv = gordonGrowthTerminalValue({ finalYearFcf: lastFcf, wacc: w, growthRate: tg }).value;
    return {
      tv,
      dcf: dcfValuation({ cashflows: fcfs, wacc: w, terminalValue: tv, terminalMethod: "gordon" }).value,
    };
  };
  const perShareAt = (ev: number) =>
    perShareValue({
      equityValue: enterpriseToEquity({
        enterpriseValue: ev,
        debt,
        preferred: 0,
        minorityInterest: 0,
        cash,
        nonOperatingAssets: 0,
      }).value.equityValue,
      dilutedShares: shares,
    }).value;

  const main = evAt(rate, g);
  const equityValue = enterpriseToEquity({
    enterpriseValue: main.dcf.enterpriseValue,
    debt,
    preferred: 0,
    minorityInterest: 0,
    cash,
    nonOperatingAssets: 0,
  }).value.equityValue;

  const grid = panel.sensitivity.rows.map((w) =>
    panel.sensitivity.cols.map((tg) => perShareAt(evAt(w, tg).dcf.enterpriseValue)),
  );

  return {
    revenues,
    ebits,
    fcfs,
    discountFactors: discountFactors(rate, fcfs.length).value,
    costOfEquity: ke,
    wacc: rate,
    terminalValue: main.tv,
    pvOfTerminal: main.dcf.pvOfTerminal,
    enterpriseValue: main.dcf.enterpriseValue,
    equityValue,
    perShare: perShareAt(main.dcf.enterpriseValue),
    terminalShareOfEv: main.dcf.terminalShareOfEV,
    grid,
  };
}

let seq = 0;
const defect = (
  d: Omit<Defect, "id" | "status" | "retries" | "expected" | "actual"> &
    Partial<Pick<Defect, "expected" | "actual">>,
): Defect => ({
  id: `d${++seq}`,
  status: "open",
  retries: 0,
  expected: null,
  actual: null,
  ...d,
});

export { defect };

/** Compare the panel's reported figures with the independent recomputation. */
export function compareValuation(panel: Panel, r: Recomputed): { defects: Defect[]; items: number } {
  const defects: Defect[] = [];
  let items = 0;
  const cmp = (subject: string, expected: number, actual: number | null, rel = 1e-9) => {
    items++;
    if (actual === null || !close(expected, actual, rel)) {
      defects.push(
        defect({
          type: "calc_mismatch",
          severity: "error",
          ownerNode: "modeling",
          subject,
          detail: `${subject} is ${actual === null ? "missing" : actual} in the deliverable but the Verifier's own recomputation from the stated assumptions gives ${expected}.`,
          expected,
          actual,
        }),
      );
    }
  };

  const v = panel.valuation;
  cmp("valuation.enterpriseValue", r.enterpriseValue, v.enterpriseValue);
  cmp("valuation.equityValue", r.equityValue, v.equityValue);
  cmp("valuation.perShare", r.perShare, v.perShare);
  cmp("valuation.wacc", r.wacc, v.wacc);
  cmp(
    "valuation.terminalGrowth",
    panel.assumptions.find((a) => a.key === "terminal_growth")?.value ?? Number.NaN,
    v.terminalGrowth,
  );
  if (r.terminalShareOfEv !== null)
    cmp("valuation.terminalShareOfEv", r.terminalShareOfEv, v.terminalShareOfEv);

  panel.projection.forEach((p, k) => {
    cmp(`projection[${k}].revenue`, r.revenues[k] ?? Number.NaN, p.revenue);
    cmp(`projection[${k}].ebit`, r.ebits[k] ?? Number.NaN, p.ebit);
    cmp(`projection[${k}].ufcf`, r.fcfs[k] ?? Number.NaN, p.ufcf);
    cmp(`projection[${k}].discountFactor`, r.discountFactors[k] ?? Number.NaN, p.discountFactor);
  });
  if (panel.projection.length !== r.fcfs.length) {
    items++;
    defects.push(
      defect({
        type: "calc_mismatch",
        severity: "error",
        ownerNode: "modeling",
        subject: "projection.length",
        detail: `The projection has ${panel.projection.length} years but the assumptions imply ${r.fcfs.length}.`,
        expected: r.fcfs.length,
        actual: panel.projection.length,
      }),
    );
  }

  for (const [ri, row] of panel.sensitivity.values.entries()) {
    for (const [ci, x] of row.entries()) cmp(`sensitivity[${ri}][${ci}]`, r.grid[ri]?.[ci] ?? Number.NaN, x);
  }
  return { defects, items };
}
