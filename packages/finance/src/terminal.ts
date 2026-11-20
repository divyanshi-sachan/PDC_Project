/**
 * Terminal value: Gordon growth, exit multiple, and the cross-checks between them.
 *
 * Period convention: "final year" means the last explicit projection year N (FY). Every terminal value is
 * as of the end of year N (undiscounted); {@link dcfValuation} discounts it. The implied growth / implied
 * multiple cross-checks equate the undiscounted TVs. That is exact for end-year discounting; under mid-year,
 * `dcfValuation` discounts a Gordon TV at N − 0.5 but an exit-multiple TV at N, so equal TVs give EVs that
 * differ by the factor (1 + WACC)^0.5 on the TV term.
 */
import { assertDiscountRate, assertFinite, assertPositive, FinanceInputError } from "./errors.ts";
import { type CalcResult, result } from "./result.ts";

function assertGrowthBelowWacc(growthRate: number, wacc: number): void {
  assertDiscountRate(wacc, "wacc");
  assertDiscountRate(growthRate, "growthRate");
  if (growthRate >= wacc) {
    throw new FinanceInputError(
      "GROWTH_GE_DISCOUNT_RATE",
      `growthRate (${growthRate}) must be below wacc (${wacc}) for Gordon growth`,
    );
  }
}

/**
 * Gordon growth terminal value: TV_N = FCF_N·(1 + g) / (WACC − g).
 *
 * FCF_N is the final projected year's UFCF (currency); g and WACC are annual `rate`s. Output: currency as
 * of the end of year N. A negative FCF_N yields a negative TV (allowed, but usually a modelling red flag).
 * @throws FinanceInputError `GROWTH_GE_DISCOUNT_RATE` if g ≥ WACC; `OUT_OF_RANGE` if g or WACC ≤ −1.
 */
export function gordonGrowthTerminalValue(i: {
  finalYearFcf: number;
  wacc: number;
  growthRate: number;
}): CalcResult<number> {
  assertFinite(i.finalYearFcf, "finalYearFcf");
  assertGrowthBelowWacc(i.growthRate, i.wacc);
  return result(
    "terminal.gordon",
    (i.finalYearFcf * (1 + i.growthRate)) / (i.wacc - i.growthRate),
    "currency",
    { ...i },
  );
}

/**
 * Exit-multiple terminal value: TV_N = metric_N × multiple (e.g. EBITDA_N × EV/EBITDA).
 *
 * Units: metric in currency (final-year FY figure, or NTM-from-N if the multiple is forward), multiple in
 * `multiple` (x); output currency as of the end of year N.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if metric ≤ 0 or multiple ≤ 0 (a multiple of a
 *   non-positive metric is meaningless).
 */
export function exitMultipleTerminalValue(i: {
  finalYearMetric: number;
  exitMultiple: number;
}): CalcResult<number> {
  assertPositive(i.finalYearMetric, "finalYearMetric");
  assertPositive(i.exitMultiple, "exitMultiple");
  return result("terminal.exit_multiple", i.finalYearMetric * i.exitMultiple, "currency", { ...i });
}

/**
 * Perpetual growth rate implied by an exit multiple. Solves FCF_N·(1 + g)/(WACC − g) = TV for g, with
 * TV = metric_N × multiple:
 *
 *   g = (TV·WACC − FCF_N) / (TV + FCF_N)
 *
 * Units: currency for FCF and metric, `multiple` for the multiple, `rate` for WACC and the output.
 * FCF_N must be > 0: then TV + FCF_N > 0 and the result is always < WACC (with FCF_N ≤ 0 the formula
 * would return g ≥ WACC, which no Gordon model can reproduce).
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if FCF_N, metric or multiple ≤ 0;
 *   `OUT_OF_RANGE` if WACC ≤ −1.
 */
export function impliedPerpetualGrowth(i: {
  finalYearFcf: number;
  finalYearMetric: number;
  exitMultiple: number;
  wacc: number;
}): CalcResult<number> {
  assertPositive(i.finalYearFcf, "finalYearFcf");
  assertDiscountRate(i.wacc, "wacc");
  const tv = exitMultipleTerminalValue({
    finalYearMetric: i.finalYearMetric,
    exitMultiple: i.exitMultiple,
  }).value;
  return result("terminal.implied_growth", (tv * i.wacc - i.finalYearFcf) / (tv + i.finalYearFcf), "rate", {
    ...i,
    terminalValue: tv,
  });
}

/**
 * Exit multiple implied by a Gordon growth terminal value: multiple = TV_Gordon / metric_N
 * = FCF_N·(1 + g) / ((WACC − g)·metric_N).
 *
 * Units: currency for FCF and metric, `rate` for g and WACC, output `multiple`. FCF_N must be > 0
 * (consistent with {@link impliedPerpetualGrowth}; a non-positive implied multiple is meaningless).
 * @throws FinanceInputError `GROWTH_GE_DISCOUNT_RATE` if g ≥ WACC; `NON_POSITIVE_DENOMINATOR` if FCF_N or
 *   metric ≤ 0.
 */
export function impliedExitMultiple(i: {
  finalYearFcf: number;
  finalYearMetric: number;
  wacc: number;
  growthRate: number;
}): CalcResult<number> {
  assertPositive(i.finalYearFcf, "finalYearFcf");
  assertPositive(i.finalYearMetric, "finalYearMetric");
  const tv = gordonGrowthTerminalValue({
    finalYearFcf: i.finalYearFcf,
    wacc: i.wacc,
    growthRate: i.growthRate,
  }).value;
  return result("terminal.implied_exit_multiple", tv / i.finalYearMetric, "multiple", {
    ...i,
    terminalValue: tv,
  });
}
