/**
 * Test helpers for `@dealpilot/finance`. Not exported from the package index.
 */

/**
 * True when `a` and `b` agree within a relative tolerance:
 * |a − b| ≤ tol · max(1, |a|, |b|). The `max(1, …)` floor makes it an absolute tolerance near zero.
 */
export function relClose(a: number, b: number, tol = 1e-9): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

/** Throws a descriptive error unless {@link relClose}(actual, expected, tol). */
export function expectRelClose(actual: number, expected: number, tol = 1e-9): void {
  if (!relClose(actual, expected, tol)) {
    throw new Error(`expected ${actual} to be within rel tol ${tol} of ${expected}`);
  }
}
