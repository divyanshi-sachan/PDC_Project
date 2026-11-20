/**
 * Error type and input guards shared by every `@dealpilot/finance` function.
 *
 * Every invalid input is reported by throwing {@link FinanceInputError} with a machine-readable
 * `code`. Functions never return `NaN` or `Infinity` silently.
 */

/** Machine-readable reason a finance input was rejected. */
export type FinanceInputErrorCode =
  /** An input (or a computed result) is `NaN`, `Infinity` or `-Infinity`. */
  | "NON_FINITE"
  /** A denominator is zero or negative where the ratio is meaningless. */
  | "NON_POSITIVE_DENOMINATOR"
  /** A value is outside its allowed range (e.g. a negative balance, a tax rate above 100%). */
  | "OUT_OF_RANGE"
  /** Gordon growth with a perpetual growth rate at or above the discount rate. */
  | "GROWTH_GE_DISCOUNT_RATE"
  /** An array that must have at least one element is empty (or empty after exclusions). */
  | "EMPTY_INPUT"
  /** An iterative solver did not converge within its iteration cap. */
  | "NO_CONVERGENCE"
  /** A structural argument is invalid (e.g. a non-integer period count). */
  | "INVALID_ARGUMENT";

/** Thrown by every finance function when its input is invalid. */
export class FinanceInputError extends Error {
  override readonly name = "FinanceInputError";
  readonly code: FinanceInputErrorCode;

  constructor(code: FinanceInputErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Asserts that `value` is a finite number (not `NaN`, `Infinity` or `-Infinity`).
 *
 * @param value - The number to check.
 * @param name - The input's name, used in the error message.
 * @throws FinanceInputError `NON_FINITE` when the value is not finite.
 */
export function assertFinite(value: number, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new FinanceInputError("NON_FINITE", `${name} must be a finite number, got ${String(value)}`);
  }
}

/**
 * Asserts that every element of `values` is finite.
 *
 * @throws FinanceInputError `NON_FINITE` naming the first offending index.
 */
export function assertFiniteArray(values: readonly number[], name: string): void {
  values.forEach((v, i) => {
    assertFinite(v, `${name}[${i}]`);
  });
}

/**
 * Asserts that `value` is finite and strictly greater than zero. Used for denominators.
 *
 * @throws FinanceInputError `NON_FINITE` or `NON_POSITIVE_DENOMINATOR`.
 */
export function assertPositive(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0) {
    throw new FinanceInputError("NON_POSITIVE_DENOMINATOR", `${name} must be > 0, got ${value}`);
  }
}

/**
 * Asserts that `value` is finite and at least zero. Used for balances and magnitudes
 * (debt, cash, share counts) whose sign is fixed by the function's convention.
 *
 * @throws FinanceInputError `NON_FINITE` or `OUT_OF_RANGE`.
 */
export function assertNonNegative(value: number, name: string): void {
  assertFinite(value, name);
  if (value < 0) {
    throw new FinanceInputError("OUT_OF_RANGE", `${name} must be >= 0, got ${value}`);
  }
}

/**
 * Asserts that a tax rate is a finite decimal in [0, 1] (0.25 = 25%).
 *
 * @throws FinanceInputError `NON_FINITE` or `OUT_OF_RANGE`.
 */
export function assertTaxRate(value: number, name = "taxRate"): void {
  assertFinite(value, name);
  if (value < 0 || value > 1) {
    throw new FinanceInputError("OUT_OF_RANGE", `${name} must be in [0, 1], got ${value}`);
  }
}

/**
 * Asserts that a periodic discount rate is finite and greater than -100% (so 1 + r > 0).
 *
 * @throws FinanceInputError `NON_FINITE` or `OUT_OF_RANGE`.
 */
export function assertDiscountRate(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= -1) {
    throw new FinanceInputError("OUT_OF_RANGE", `${name} must be > -1, got ${value}`);
  }
}
