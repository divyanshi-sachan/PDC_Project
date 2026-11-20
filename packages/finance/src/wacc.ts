/**
 * Cost of capital: CAPM, after-tax cost of debt, WACC and beta unlevering/relevering (Hamada).
 *
 * All rates are decimals per year (0.05 = 5%). Tax rates are decimals in [0, 1].
 */
import { assertFinite, assertNonNegative, assertPositive, assertTaxRate } from "./errors.ts";
import { type CalcResult, result } from "./result.ts";

/**
 * CAPM cost of equity: ke = rf + β·ERP + sizePremium.
 *
 * Units: `rate` in and out. rf may be negative (e.g. negative-yield markets); β and ERP any finite value.
 * sizePremium defaults to 0. The rf, ERP and premium must share a basis (same currency, same horizon).
 * @throws FinanceInputError `NON_FINITE` on non-finite input.
 */
export function costOfEquityCapm(i: {
  riskFreeRate: number;
  beta: number;
  equityRiskPremium: number;
  sizePremium?: number;
}): CalcResult<number> {
  const sizePremium = i.sizePremium ?? 0;
  assertFinite(i.riskFreeRate, "riskFreeRate");
  assertFinite(i.beta, "beta");
  assertFinite(i.equityRiskPremium, "equityRiskPremium");
  assertFinite(sizePremium, "sizePremium");
  return result(
    "wacc.cost_of_equity_capm",
    i.riskFreeRate + i.beta * i.equityRiskPremium + sizePremium,
    "rate",
    { ...i, sizePremium },
  );
}

/**
 * After-tax cost of debt: kd_after = kd·(1 − t).
 *
 * Units: `rate` in and out; t a decimal in [0, 1]. Assumes interest is fully tax-deductible.
 * @throws FinanceInputError `OUT_OF_RANGE` if t ∉ [0, 1]; `NON_FINITE` on non-finite input.
 */
export function afterTaxCostOfDebt(i: { preTaxCostOfDebt: number; taxRate: number }): CalcResult<number> {
  assertFinite(i.preTaxCostOfDebt, "preTaxCostOfDebt");
  assertTaxRate(i.taxRate);
  return result("wacc.after_tax_cost_of_debt", i.preTaxCostOfDebt * (1 - i.taxRate), "rate", { ...i });
}

/**
 * Weighted average cost of capital with **market-value** weights:
 *
 *   WACC = E/(D + E)·ke + D/(D + E)·kd·(1 − t)
 *
 * E is the market value of equity and D the market (or fair) value of debt, in the same currency.
 * Units: currency for E and D, `rate` for ke, kd and the output, t a decimal in [0, 1].
 * Preferred equity is not a separate tranche here; fold it into D or E before calling.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if E ≤ 0; `OUT_OF_RANGE` if D < 0 or t ∉ [0, 1].
 */
export function wacc(i: {
  equityValue: number;
  debtValue: number;
  costOfEquity: number;
  preTaxCostOfDebt: number;
  taxRate: number;
}): CalcResult<number> {
  assertPositive(i.equityValue, "equityValue");
  assertNonNegative(i.debtValue, "debtValue");
  assertFinite(i.costOfEquity, "costOfEquity");
  const kdAfterTax = afterTaxCostOfDebt({ preTaxCostOfDebt: i.preTaxCostOfDebt, taxRate: i.taxRate }).value;
  const total = i.equityValue + i.debtValue;
  const equityWeight = i.equityValue / total;
  const debtWeight = i.debtValue / total;
  return result("wacc.wacc", equityWeight * i.costOfEquity + debtWeight * kdAfterTax, "rate", {
    ...i,
    equityWeight,
    debtWeight,
    afterTaxCostOfDebt: kdAfterTax,
  });
}

/**
 * Hamada unlevering: βU = βL / (1 + (1 − t)·D/E).
 *
 * Assumes debt beta = 0 and a constant D/E. Units: `beta` in and out, D/E a `multiple` (≥ 0, market values),
 * t a decimal in [0, 1].
 * @throws FinanceInputError `OUT_OF_RANGE` if D/E < 0 or t ∉ [0, 1].
 */
export function unleverBeta(i: {
  leveredBeta: number;
  debtToEquity: number;
  taxRate: number;
}): CalcResult<number> {
  assertFinite(i.leveredBeta, "leveredBeta");
  assertNonNegative(i.debtToEquity, "debtToEquity");
  assertTaxRate(i.taxRate);
  return result("wacc.unlever_beta", i.leveredBeta / (1 + (1 - i.taxRate) * i.debtToEquity), "beta", {
    ...i,
  });
}

/**
 * Hamada relevering: βL = βU·(1 + (1 − t)·D/E). Inverse of {@link unleverBeta}.
 *
 * Units: `beta` in and out, D/E a `multiple` (≥ 0, target market-value capital structure), t in [0, 1].
 * @throws FinanceInputError `OUT_OF_RANGE` if D/E < 0 or t ∉ [0, 1].
 */
export function releverBeta(i: {
  unleveredBeta: number;
  debtToEquity: number;
  taxRate: number;
}): CalcResult<number> {
  assertFinite(i.unleveredBeta, "unleveredBeta");
  assertNonNegative(i.debtToEquity, "debtToEquity");
  assertTaxRate(i.taxRate);
  return result("wacc.relever_beta", i.unleveredBeta * (1 + (1 - i.taxRate) * i.debtToEquity), "beta", {
    ...i,
  });
}
