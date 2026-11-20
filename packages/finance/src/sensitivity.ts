/**
 * Sensitivity tables: a generic 2-D grid and ready-made DCF enterprise-value grids.
 */
import { dcfValuation } from "./dcf.ts";
import { assertFiniteArray, FinanceInputError } from "./errors.ts";
import { type CalcResult, result, type Unit } from "./result.ts";
import { exitMultipleTerminalValue, gordonGrowthTerminalValue } from "./terminal.ts";

/** A 2-D grid: values[r][c] = fn(rows[r], cols[c]). */
export interface Grid {
  rows: number[];
  cols: number[];
  values: number[][];
}

function assertAxis(values: readonly number[], name: string): void {
  if (values.length === 0) throw new FinanceInputError("EMPTY_INPUT", `${name} must not be empty`);
  assertFiniteArray(values, name);
}

/**
 * Generic 2-D sensitivity grid: values[r][c] = fn(rowValues[r], colValues[c]).
 *
 * `fn` must be pure. Errors thrown by `fn` propagate (the grid is all-or-nothing). Units: whatever `fn`
 * returns; pass `meta.unit` and `meta.formulaId` to label the result (defaults `number` /
 * `sensitivity.grid`).
 * @throws FinanceInputError `EMPTY_INPUT` if an axis is empty; `NON_FINITE` on a non-finite axis value or cell.
 */
export function sensitivityGrid(
  rowValues: readonly number[],
  colValues: readonly number[],
  fn: (row: number, col: number) => number,
  meta: { unit?: Unit; formulaId?: string; inputs?: Record<string, unknown> } = {},
): CalcResult<Grid> {
  assertAxis(rowValues, "rowValues");
  assertAxis(colValues, "colValues");
  const values = rowValues.map((r) => colValues.map((c) => fn(r, c)));
  return result(
    meta.formulaId ?? "sensitivity.grid",
    { rows: [...rowValues], cols: [...colValues], values },
    meta.unit ?? "number",
    // meta.inputs first, so the real axes can never be overwritten by caller-supplied inputs.
    { ...meta.inputs, rowValues: [...rowValues], colValues: [...colValues] },
  );
}

/**
 * EV sensitivity to WACC (rows) × perpetual growth g (cols), with a Gordon growth terminal value:
 *
 *   EV(w, g) = dcfValuation(cashflows, w, TV = UFCF_N·(1 + g)/(w − g)).enterpriseValue
 *
 * Calls {@link dcfValuation} with `terminalMethod: "gordon"`, so under `midYear` the TV is discounted at
 * N − 0.5 (end-year: N). Units: `rate` axes, currency cells.
 * @throws FinanceInputError `GROWTH_GE_DISCOUNT_RATE` if any g ≥ any w on the grid (choose axes with every
 *   g below every WACC); `EMPTY_INPUT` for empty cashflows or axes.
 */
export function waccGrowthSensitivity(i: {
  cashflows: readonly number[];
  waccValues: readonly number[];
  growthValues: readonly number[];
  midYear?: boolean;
}): CalcResult<Grid> {
  const midYear = i.midYear ?? false;
  if (i.cashflows.length === 0) throw new FinanceInputError("EMPTY_INPUT", "cashflows must not be empty");
  const finalYearFcf = i.cashflows[i.cashflows.length - 1] ?? Number.NaN;
  return sensitivityGrid(
    i.waccValues,
    i.growthValues,
    (w, g) => {
      const tv = gordonGrowthTerminalValue({ finalYearFcf, wacc: w, growthRate: g }).value;
      return dcfValuation({
        cashflows: i.cashflows,
        wacc: w,
        terminalValue: tv,
        terminalMethod: "gordon",
        midYear,
      }).value.enterpriseValue;
    },
    {
      unit: "currency",
      formulaId: "sensitivity.wacc_growth",
      inputs: { cashflows: [...i.cashflows], midYear },
    },
  );
}

/**
 * EV sensitivity to WACC (rows) × exit multiple (cols), with TV = finalYearMetric × multiple:
 *
 *   EV(w, m) = dcfValuation(cashflows, w, TV = metric_N × m).enterpriseValue
 *
 * Calls {@link dcfValuation} with `terminalMethod: "exitMultiple"`, so the TV is discounted at full N even
 * under `midYear`. Units: `rate` rows, `multiple` cols, currency cells.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if the metric or any multiple ≤ 0; `EMPTY_INPUT`.
 */
export function waccExitMultipleSensitivity(i: {
  cashflows: readonly number[];
  finalYearMetric: number;
  waccValues: readonly number[];
  multipleValues: readonly number[];
  midYear?: boolean;
}): CalcResult<Grid> {
  const midYear = i.midYear ?? false;
  return sensitivityGrid(
    i.waccValues,
    i.multipleValues,
    (w, m) => {
      const tv = exitMultipleTerminalValue({ finalYearMetric: i.finalYearMetric, exitMultiple: m }).value;
      return dcfValuation({
        cashflows: i.cashflows,
        wacc: w,
        terminalValue: tv,
        terminalMethod: "exitMultiple",
        midYear,
      }).value.enterpriseValue;
    },
    {
      unit: "currency",
      formulaId: "sensitivity.wacc_exit_multiple",
      inputs: { cashflows: [...i.cashflows], finalYearMetric: i.finalYearMetric, midYear },
    },
  );
}
