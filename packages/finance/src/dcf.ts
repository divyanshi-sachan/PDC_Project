/**
 * Discounted cash flow: unlevered FCF, discount factors, present value and the DCF enterprise value.
 *
 * Period convention: cashflows are annual (FY projections), period t = 1..N, valued as of the start of
 * period 1 (the valuation date). The discount rate is a decimal per period.
 */
import {
  assertDiscountRate,
  assertFinite,
  assertFiniteArray,
  assertNonNegative,
  assertTaxRate,
  FinanceInputError,
} from "./errors.ts";
import { type CalcResult, result } from "./result.ts";

/** Discounting options. */
export interface DiscountOptions {
  /**
   * Mid-year convention: discount period t's cashflow at exponent t − 0.5 instead of t, i.e. cashflows
   * arrive evenly through the year. Off by default; record it in the workbook.
   */
  midYear?: boolean;
}

/**
 * Unlevered free cash flow: UFCF = EBIT·(1 − t) + D&A − capex − ΔNWC.
 *
 * Sign convention: capex is a **positive** number meaning a cash outflow; D&A is a positive add-back;
 * ΔNWC is the increase in net working capital (positive = cash outflow, negative = release).
 * EBIT may be negative. Deliberate choice: the tax term is then a **full tax shield** (EBIT·(1 − t) is
 * less negative than EBIT, as if the loss is immediately offset against other taxable income). NOLs,
 * tax floors at zero and loss carry-forwards are not modelled; adjust EBIT or t upstream if needed.
 * Units: currency in and out (one period, e.g. FY), t a decimal in [0, 1].
 * @throws FinanceInputError `OUT_OF_RANGE` if capex < 0, D&A < 0 or t ∉ [0, 1]; `NON_FINITE` on non-finite input.
 */
export function ufcf(i: {
  ebit: number;
  taxRate: number;
  depreciationAndAmortization: number;
  capex: number;
  changeInNwc: number;
}): CalcResult<number> {
  assertFinite(i.ebit, "ebit");
  assertTaxRate(i.taxRate);
  assertNonNegative(i.depreciationAndAmortization, "depreciationAndAmortization");
  assertNonNegative(i.capex, "capex");
  assertFinite(i.changeInNwc, "changeInNwc");
  const value = i.ebit * (1 - i.taxRate) + i.depreciationAndAmortization - i.capex - i.changeInNwc;
  return result("dcf.ufcf", value, "currency", { ...i });
}

/**
 * Discount factors DF_t = 1 / (1 + r)^e_t for t = 1..n, where e_t = t (end-year) or t − 0.5 (mid-year).
 *
 * Units: r is a `rate` per period; output `factor` array of length n.
 * @param rate - Discount rate per period, must be > −1.
 * @param n - Number of periods, a positive integer.
 * @throws FinanceInputError `OUT_OF_RANGE` if r ≤ −1; `INVALID_ARGUMENT` if n is not a positive integer.
 */
export function discountFactors(
  rate: number,
  n: number,
  options: DiscountOptions = {},
): CalcResult<number[]> {
  assertDiscountRate(rate, "rate");
  if (!Number.isInteger(n) || n < 1) {
    throw new FinanceInputError("INVALID_ARGUMENT", `n must be a positive integer, got ${n}`);
  }
  const midYear = options.midYear ?? false;
  const factors: number[] = [];
  for (let t = 1; t <= n; t++) factors.push(1 / (1 + rate) ** (midYear ? t - 0.5 : t));
  return result("dcf.discount_factors", factors, "factor", { rate, n, midYear });
}

/**
 * Present value PV = Σ_{t=1..N} CF_t · DF_t, with DF_t from {@link discountFactors}.
 *
 * Sign convention: inflows positive, outflows negative. cashflows[0] is period 1 (not t = 0).
 * Units: currency in and out.
 * @throws FinanceInputError `EMPTY_INPUT` if cashflows is empty; `NON_FINITE`; `OUT_OF_RANGE` if r ≤ −1.
 */
export function presentValue(
  cashflows: readonly number[],
  rate: number,
  options: DiscountOptions = {},
): CalcResult<number> {
  if (cashflows.length === 0) throw new FinanceInputError("EMPTY_INPUT", "cashflows must not be empty");
  assertFiniteArray(cashflows, "cashflows");
  const midYear = options.midYear ?? false;
  const dfs = discountFactors(rate, cashflows.length, { midYear }).value;
  let pv = 0;
  cashflows.forEach((cf, idx) => {
    pv += cf * (dfs[idx] ?? 0);
  });
  return result("dcf.present_value", pv, "currency", { cashflows: [...cashflows], rate, midYear });
}

/** How the terminal value was derived; it decides the TV discount exponent under mid-year. */
export type TerminalMethod = "gordon" | "exitMultiple";

/** Output of {@link dcfValuation}. */
export interface DcfValuation {
  /** PV of the explicit-period cashflows. */
  pvOfCashflows: number;
  /** PV of the terminal value (exponent N, or N − 0.5 for a mid-year Gordon TV). */
  pvOfTerminal: number;
  /** pvOfCashflows + pvOfTerminal. */
  enterpriseValue: number;
  /** pvOfTerminal / enterpriseValue; `null` when EV ≤ 0 (the share is not meaningful). */
  terminalShareOfEV: number | null;
}

/**
 * DCF enterprise value:
 *
 *   EV = Σ_{t=1..N} UFCF_t · DF_t + TV_N / (1 + WACC)^e
 *
 * The terminal-value discount exponent `e` depends on `terminalMethod` and `midYear`:
 * - `"exitMultiple"`: e = N always. The TV is a sale of the business at the end of year N, so it is
 *   not shifted by the mid-year convention.
 * - `"gordon"`: e = N (end-year) or N − 0.5 (mid-year). The Gordon TV is the value of the year N+1…∞
 *   cashflows, which under mid-year also arrive mid-period, so the whole perpetuity shifts by half a year
 *   (equivalently, TV·(1 + WACC)^0.5 discounted at N).
 *
 * With `midYear` off, both methods discount at N. Units: currency for cashflows, TV and outputs; WACC a
 * `rate` (> −1).
 * @throws FinanceInputError `EMPTY_INPUT`, `NON_FINITE`, `OUT_OF_RANGE` (WACC ≤ −1), `INVALID_ARGUMENT`
 *   (unknown terminalMethod).
 */
export function dcfValuation(i: {
  cashflows: readonly number[];
  wacc: number;
  terminalValue: number;
  terminalMethod: TerminalMethod;
  midYear?: boolean;
}): CalcResult<DcfValuation> {
  const midYear = i.midYear ?? false;
  assertFinite(i.terminalValue, "terminalValue");
  if (i.terminalMethod !== "gordon" && i.terminalMethod !== "exitMultiple") {
    throw new FinanceInputError("INVALID_ARGUMENT", `unknown terminalMethod ${String(i.terminalMethod)}`);
  }
  const pvOfCashflows = presentValue(i.cashflows, i.wacc, { midYear }).value;
  const n = i.cashflows.length;
  const tvExponent = midYear && i.terminalMethod === "gordon" ? n - 0.5 : n;
  const pvOfTerminal = i.terminalValue / (1 + i.wacc) ** tvExponent;
  const enterpriseValue = pvOfCashflows + pvOfTerminal;
  return result(
    "dcf.valuation",
    {
      pvOfCashflows,
      pvOfTerminal,
      enterpriseValue,
      terminalShareOfEV: enterpriseValue > 0 ? pvOfTerminal / enterpriseValue : null,
    },
    "currency",
    {
      cashflows: [...i.cashflows],
      wacc: i.wacc,
      terminalValue: i.terminalValue,
      terminalMethod: i.terminalMethod,
      midYear,
      tvExponent,
    },
  );
}
