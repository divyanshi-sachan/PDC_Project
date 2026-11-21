/**
 * Market-derived quantities computed from licensed/user inputs and SEC-reported shares.
 * DealPilot never fetches a vendor's market cap: it owns the formula so the inputs and dates are auditable.
 * Pure and deterministic.
 */
import { assertFinite, assertFiniteArray, assertPositive, FinanceInputError } from "./errors.ts";
import { type CalcResult, result } from "./result.ts";

/**
 * Equity market capitalisation = share price × shares outstanding.
 * @param i.price  price per share in currency units (> 0)
 * @param i.shares shares outstanding in shares, not millions (> 0)
 * @returns market cap in currency units
 */
export function marketCap(i: { price: number; shares: number }): CalcResult<number> {
  assertPositive(i.price, "price");
  assertPositive(i.shares, "shares");
  return result("market.market_cap", i.price * i.shares, "currency", { ...i });
}

/**
 * Current diluted share estimate from the latest cover-page (basic) count and the dilution seen in the latest
 * fiscal year: diluted_now = cover shares × (weighted diluted / weighted basic).
 * The ratio is ≥ 1 for ordinary companies; a ratio below 1 (anti-dilutive reporting) is rejected as suspicious.
 * @param i.coverShares     latest reported shares outstanding (> 0)
 * @param i.weightedBasic   fiscal-year weighted-average basic shares (> 0)
 * @param i.weightedDiluted fiscal-year weighted-average diluted shares (> 0)
 */
export function dilutedSharesEstimate(i: {
  coverShares: number;
  weightedBasic: number;
  weightedDiluted: number;
}): CalcResult<number> {
  assertPositive(i.coverShares, "coverShares");
  assertPositive(i.weightedBasic, "weightedBasic");
  assertPositive(i.weightedDiluted, "weightedDiluted");
  const ratio = i.weightedDiluted / i.weightedBasic;
  if (ratio < 1 || ratio > 1.5) {
    throw new FinanceInputError("OUT_OF_RANGE", `dilution ratio ${ratio} is outside [1, 1.5]`);
  }
  return result("shares.diluted_estimate", i.coverShares * ratio, "shares", { ...i, ratio });
}

/**
 * Simple (arithmetic) period returns from an ordered price series: r_t = P_t / P_{t−1} − 1.
 * @param i.prices at least 2 prices, oldest first, all > 0
 * @returns prices.length − 1 returns
 */
export function simpleReturns(i: { prices: readonly number[] }): CalcResult<number[]> {
  if (i.prices.length < 2) throw new FinanceInputError("EMPTY_INPUT", "need at least 2 prices");
  assertFiniteArray(i.prices, "prices");
  const out: number[] = [];
  for (let k = 1; k < i.prices.length; k++) {
    const prev = i.prices[k - 1] as number;
    if (prev <= 0) throw new FinanceInputError("NON_POSITIVE_DENOMINATOR", `price[${k - 1}] must be > 0`);
    out.push((i.prices[k] as number) / prev - 1);
  }
  return result("returns.simple", out, "rate", { prices: [...i.prices] });
}

/**
 * Regression (OLS) beta of an asset against a benchmark: β = Cov(R_i, R_m) / Var(R_m), using sample
 * (n − 1) estimators — the n−1 cancels, so it equals the OLS slope.
 * @param i.assetReturns  asset period returns
 * @param i.marketReturns benchmark returns over the same periods (same length, ≥ 3 observations)
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if the benchmark has zero variance
 */
export function betaFromReturns(i: {
  assetReturns: readonly number[];
  marketReturns: readonly number[];
}): CalcResult<number> {
  assertFiniteArray(i.assetReturns, "assetReturns");
  assertFiniteArray(i.marketReturns, "marketReturns");
  const n = i.assetReturns.length;
  if (n !== i.marketReturns.length) {
    throw new FinanceInputError("INVALID_ARGUMENT", "asset and market returns must have the same length");
  }
  if (n < 3) throw new FinanceInputError("EMPTY_INPUT", "need at least 3 return observations");
  const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const ma = mean(i.assetReturns);
  const mm = mean(i.marketReturns);
  let cov = 0;
  let varM = 0;
  for (let k = 0; k < n; k++) {
    const da = (i.assetReturns[k] as number) - ma;
    const dm = (i.marketReturns[k] as number) - mm;
    cov += da * dm;
    varM += dm * dm;
  }
  if (varM <= 0)
    throw new FinanceInputError("NON_POSITIVE_DENOMINATOR", "benchmark returns have zero variance");
  assertFinite(cov, "covariance");
  return result("beta.regression", cov / varM, "beta", {
    assetReturns: [...i.assetReturns],
    marketReturns: [...i.marketReturns],
  });
}

/**
 * Industry beta relevered to a company's capital structure (Hamada, debt beta 0):
 * β_L = β_U · (1 + (1 − t) · D/E). Convenience wrapper input is the unlevered industry beta.
 * @param i.unleveredBeta industry unlevered beta (> 0)
 * @param i.debtToEquity  market D/E (≥ 0)
 * @param i.taxRate       marginal tax rate in [0, 1]
 */
export function relevered(i: {
  unleveredBeta: number;
  debtToEquity: number;
  taxRate: number;
}): CalcResult<number> {
  assertPositive(i.unleveredBeta, "unleveredBeta");
  if (!(i.debtToEquity >= 0) || !Number.isFinite(i.debtToEquity)) {
    throw new FinanceInputError("OUT_OF_RANGE", "debtToEquity must be a finite number ≥ 0");
  }
  if (!(i.taxRate >= 0 && i.taxRate <= 1))
    throw new FinanceInputError("OUT_OF_RANGE", "taxRate must be in [0, 1]");
  return result("beta.relevered", i.unleveredBeta * (1 + (1 - i.taxRate) * i.debtToEquity), "beta", { ...i });
}
