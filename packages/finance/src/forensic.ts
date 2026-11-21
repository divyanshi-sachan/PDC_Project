/**
 * Forensic-accounting statistics used by the Forensic agent's red-flag rules. Pure and deterministic.
 *
 * Conventions: amounts are in base currency units and must share one currency; growth rates and ratios
 * are decimals (0.05 = 5%). Series are given in chronological order (oldest first, newest last).
 */
import { assertFinite, assertFiniteArray, assertPositive, FinanceInputError } from "./errors.ts";
import { type CalcResult, result } from "./result.ts";

/**
 * Accruals ratio (balance-sheet-scaled): (netIncome − operatingCashFlow) / averageTotalAssets.
 *
 * Sign convention: positive = earnings exceed cash generation (lower earnings quality); negative = cash
 * flow exceeds earnings. Units: currency in, `ratio` out. `averageTotalAssets` is typically the mean of
 * opening and closing total assets for the same fiscal year.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if averageTotalAssets ≤ 0; `NON_FINITE` on bad input.
 */
export function accrualsRatio(i: {
  netIncome: number;
  operatingCashFlow: number;
  averageTotalAssets: number;
}): CalcResult<number> {
  assertFinite(i.netIncome, "netIncome");
  assertFinite(i.operatingCashFlow, "operatingCashFlow");
  assertPositive(i.averageTotalAssets, "averageTotalAssets");
  return result(
    "forensic.accruals_ratio",
    (i.netIncome - i.operatingCashFlow) / i.averageTotalAssets,
    "ratio",
    { ...i },
  );
}

/**
 * Growth gap: growthA − growthB, e.g. receivables growth minus revenue growth.
 *
 * Units: growth rates as decimals in, a decimal difference out (0.225 = 22.5 percentage points).
 * Positive = A grew faster than B.
 * @throws FinanceInputError `NON_FINITE` on non-finite input.
 */
export function growthGap(i: { growthA: number; growthB: number }): CalcResult<number> {
  assertFinite(i.growthA, "growthA");
  assertFinite(i.growthB, "growthB");
  return result("forensic.growth_gap", i.growthA - i.growthB, "ratio", { ...i });
}

/**
 * Arithmetic mean = Σ values / n.
 *
 * Units: same as the inputs. Order does not matter.
 * @throws FinanceInputError `EMPTY_INPUT` if `values` is empty; `NON_FINITE` on non-finite input.
 */
export function arithmeticMean(i: { values: readonly number[] }): CalcResult<number> {
  assertFiniteArray(i.values, "values");
  if (i.values.length === 0) throw new FinanceInputError("EMPTY_INPUT", "arithmeticMean needs ≥ 1 value");
  return result("forensic.arithmetic_mean", mean(i.values), "ratio", { values: [...i.values] });
}

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n − 1 denominator); needs at least 2 values. */
function sampleStd(xs: readonly number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Coefficient of variation = sample standard deviation / |mean| (n − 1 denominator).
 *
 * Units: any unit in, dimensionless `ratio` out. Order of `values` does not matter.
 * @throws FinanceInputError `EMPTY_INPUT` if fewer than 3 values; `NON_POSITIVE_DENOMINATOR` if the mean is 0;
 *   `NON_FINITE` on non-finite input.
 */
export function coefficientOfVariation(i: { values: readonly number[] }): CalcResult<number> {
  assertFiniteArray(i.values, "values");
  if (i.values.length < 3) {
    throw new FinanceInputError("EMPTY_INPUT", "coefficientOfVariation needs at least 3 values");
  }
  const m = mean(i.values);
  if (m === 0) {
    throw new FinanceInputError("NON_POSITIVE_DENOMINATOR", "mean of values is 0; CV undefined");
  }
  return result("forensic.coefficient_of_variation", sampleStd(i.values) / Math.abs(m), "ratio", {
    values: [...i.values],
  });
}

/**
 * Z-score of the newest value against the older ones: (last − mean(older)) / sampleStd(older).
 *
 * `values` is chronological (oldest first); the LAST element is the one being tested and is excluded
 * from the mean and standard deviation. Units: dimensionless (`factor`).
 * @throws FinanceInputError `EMPTY_INPUT` if fewer than 4 values; `NON_POSITIVE_DENOMINATOR` if the older
 *   values have zero spread; `NON_FINITE` on non-finite input.
 */
export function zScoreOfLast(i: { values: readonly number[] }): CalcResult<number> {
  assertFiniteArray(i.values, "values");
  if (i.values.length < 4) {
    throw new FinanceInputError("EMPTY_INPUT", "zScoreOfLast needs at least 4 values");
  }
  const older = i.values.slice(0, -1);
  const last = i.values[i.values.length - 1] as number;
  const sd = sampleStd(older);
  if (!(sd > 0)) {
    throw new FinanceInputError(
      "NON_POSITIVE_DENOMINATOR",
      "older values have zero spread; z-score undefined",
    );
  }
  return result("forensic.z_score_of_last", (last - mean(older)) / sd, "factor", {
    values: [...i.values],
  });
}
