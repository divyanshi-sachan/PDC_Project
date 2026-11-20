import { FinanceInputError } from "./errors.ts";

/**
 * The traceable output of every finance function.
 *
 * - `value`: the computed figure (a number, or a structured object for bridges, grids and summaries).
 * - `unit`: the unit of `value` (see {@link Unit}).
 * - `formulaId`: a stable dotted id (e.g. `dcf.ufcf`) that matches the workbook formula template.
 * - `inputs`: the inputs the value was computed from, so the Verifier can recompute it.
 */
export interface CalcResult<T> {
  value: T;
  unit: string;
  formulaId: string;
  inputs: Record<string, unknown>;
}

/**
 * Units used across the package.
 *
 * - `ratio`: a decimal fraction (0.25 = 25%).
 * - `rate`: a decimal rate per period (0.10 = 10% per year).
 * - `multiple`: a valuation multiple or coverage ratio, "x" (8.5 = 8.5x).
 * - `days`: a number of days.
 * - `beta`: a dimensionless equity beta.
 * - `currency`: the same currency and scale as the monetary inputs (the package never converts).
 * - `currency_per_share`: currency per share.
 * - `shares`: a share count, in the same scale as the share inputs.
 * - `factor`: a dimensionless discount factor.
 */
export type Unit =
  | "ratio"
  | "rate"
  | "multiple"
  | "days"
  | "beta"
  | "currency"
  | "currency_per_share"
  | "shares"
  | "factor"
  | (string & {});

function assertFiniteDeep(value: unknown, path: string): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new FinanceInputError("NON_FINITE", `result ${path} is not finite (${String(value)})`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      assertFiniteDeep(v, `${path}[${i}]`);
    });
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertFiniteDeep(v, `${path}.${k}`);
  }
}

/**
 * Builds a {@link CalcResult}, guarding that every number inside `value` is finite.
 *
 * @param formulaId - Stable dotted formula id, e.g. `dcf.ufcf`.
 * @param value - The computed value; numbers nested in arrays/objects are checked too. `null` is allowed
 *   and means "explicitly not meaningful" (documented per function).
 * @param unit - The unit of `value`.
 * @param inputs - The inputs used.
 * @throws FinanceInputError `NON_FINITE` if any number in `value` is `NaN` or infinite (e.g. overflow).
 */
export function result<T>(
  formulaId: string,
  value: T,
  unit: Unit,
  inputs: Record<string, unknown>,
): CalcResult<T> {
  assertFiniteDeep(value, formulaId);
  return { value, unit, formulaId, inputs };
}
