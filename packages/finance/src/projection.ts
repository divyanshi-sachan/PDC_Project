/**
 * Growth, ratio and projection helpers used to turn historical facts and forecast assumptions into
 * the operating projection that feeds the DCF. Pure and deterministic.
 *
 * Conventions: growth rates and margins are decimals (0.05 = 5%); amounts are in base currency units.
 */
import { assertFinite, assertFiniteArray, assertPositive, FinanceInputError } from "./errors.ts";
import { type CalcResult, result } from "./result.ts";

/**
 * Period-over-period growth: g = current / previous − 1.
 * @param i.previous prior-period amount (> 0)
 * @param i.current  current-period amount (any sign)
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if previous ≤ 0
 */
export function growthRate(i: { previous: number; current: number }): CalcResult<number> {
  assertFinite(i.current, "current");
  assertPositive(i.previous, "previous");
  return result("growth.rate", i.current / i.previous - 1, "rate", { ...i });
}

/**
 * Compound annual growth rate: CAGR = (last / first)^(1 / years) − 1.
 * @param i.first starting amount (> 0), i.last ending amount (> 0), i.years number of years between them (> 0)
 */
export function cagr(i: { first: number; last: number; years: number }): CalcResult<number> {
  assertPositive(i.first, "first");
  assertPositive(i.last, "last");
  assertPositive(i.years, "years");
  return result("growth.cagr", (i.last / i.first) ** (1 / i.years) - 1, "rate", { ...i });
}

/**
 * Share of a whole: part / whole (e.g. D&A as a fraction of revenue, capex as a fraction of revenue).
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if whole ≤ 0
 */
export function percentOf(i: { part: number; whole: number }): CalcResult<number> {
  assertFinite(i.part, "part");
  assertPositive(i.whole, "whole");
  return result("ratio.percent_of", i.part / i.whole, "ratio", { ...i });
}

/**
 * Effective tax rate = income tax expense / pre-tax income.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if pretaxIncome ≤ 0
 */
export function effectiveTaxRate(i: { incomeTax: number; pretaxIncome: number }): CalcResult<number> {
  assertFinite(i.incomeTax, "incomeTax");
  assertPositive(i.pretaxIncome, "pretaxIncome");
  return result("ratio.effective_tax_rate", i.incomeTax / i.pretaxIncome, "rate", { ...i });
}

/**
 * Revenue path from a base year: revenue_t = revenue_{t−1} · (1 + g_t), t = 1..n.
 * @returns the n projected revenues (the base year is not included)
 */
export function projectGrowth(i: { base: number; growthRates: readonly number[] }): CalcResult<number[]> {
  assertPositive(i.base, "base");
  assertFiniteArray(i.growthRates, "growthRates");
  const out: number[] = [];
  let prev = i.base;
  for (const g of i.growthRates) {
    if (g <= -1) throw new FinanceInputError("OUT_OF_RANGE", `growth rate ${g} must be > −100%`);
    prev = prev * (1 + g);
    out.push(prev);
  }
  return result("projection.growth", out, "currency", { base: i.base, growthRates: [...i.growthRates] });
}

/**
 * Element-wise driver × ratio, e.g. EBIT_t = revenue_t · EBIT margin_t. Both arrays must have equal length.
 */
export function projectByRatio(i: {
  drivers: readonly number[];
  ratios: readonly number[];
}): CalcResult<number[]> {
  assertFiniteArray(i.drivers, "drivers");
  assertFiniteArray(i.ratios, "ratios");
  if (i.drivers.length !== i.ratios.length) {
    throw new FinanceInputError("INVALID_ARGUMENT", "drivers and ratios must have the same length");
  }
  return result(
    "projection.by_ratio",
    i.drivers.map((d, k) => d * (i.ratios[k] as number)),
    "currency",
    { drivers: [...i.drivers], ratios: [...i.ratios] },
  );
}

/**
 * Change in net working capital when NWC is a fixed fraction of revenue changes:
 * ΔNWC_t = nwcRatio · (revenue_t − revenue_{t−1}). Positive = working capital increases (cash outflow).
 * @param i.baseRevenue revenue of the year before the first projected year (> 0)
 */
export function nwcChange(i: {
  nwcRatio: number;
  revenues: readonly number[];
  baseRevenue: number;
}): CalcResult<number[]> {
  assertFinite(i.nwcRatio, "nwcRatio");
  assertPositive(i.baseRevenue, "baseRevenue");
  assertFiniteArray(i.revenues, "revenues");
  let prev = i.baseRevenue;
  const out = i.revenues.map((r) => {
    const delta = i.nwcRatio * (r - prev);
    prev = r;
    return delta;
  });
  return result("projection.nwc_change", out, "currency", {
    nwcRatio: i.nwcRatio,
    revenues: [...i.revenues],
    baseRevenue: i.baseRevenue,
  });
}

/**
 * Straight-line path from `start` to `end` inclusive over `steps` points:
 * x_k = start + (end − start) · k / (steps − 1). With steps = 1 it returns [end].
 */
export function linearFade(i: { start: number; end: number; steps: number }): CalcResult<number[]> {
  assertFinite(i.start, "start");
  assertFinite(i.end, "end");
  if (!Number.isInteger(i.steps) || i.steps < 1) {
    throw new FinanceInputError("INVALID_ARGUMENT", "steps must be an integer ≥ 1");
  }
  const out =
    i.steps === 1
      ? [i.end]
      : Array.from({ length: i.steps }, (_, k) => i.start + ((i.end - i.start) * k) / (i.steps - 1));
  return result("projection.linear_fade", out, "rate", { ...i });
}

/**
 * Symmetric axis around a centre for sensitivity tables: centre + step · (k − (count−1)/2), k = 0..count−1.
 * @param i.count odd integer ≥ 1 so the centre is a grid point
 */
export function axisAround(i: { center: number; step: number; count: number }): CalcResult<number[]> {
  assertFinite(i.center, "center");
  assertPositive(i.step, "step");
  if (!Number.isInteger(i.count) || i.count < 1 || i.count % 2 === 0) {
    throw new FinanceInputError("INVALID_ARGUMENT", "count must be an odd integer ≥ 1");
  }
  const mid = (i.count - 1) / 2;
  return result(
    "sensitivity.axis_around",
    Array.from({ length: i.count }, (_, k) => i.center + i.step * (k - mid)),
    "rate",
    { ...i },
  );
}

/**
 * Arithmetic mean of a non-empty list of finite values.
 * @throws FinanceInputError `EMPTY_INPUT` for an empty list
 */
export function mean(i: { values: readonly number[] }): CalcResult<number> {
  if (i.values.length === 0) throw new FinanceInputError("EMPTY_INPUT", "values must not be empty");
  assertFiniteArray(i.values, "values");
  const sum = i.values.reduce((a, b) => a + b, 0);
  return result("stats.mean", sum / i.values.length, "ratio", { values: [...i.values] });
}
