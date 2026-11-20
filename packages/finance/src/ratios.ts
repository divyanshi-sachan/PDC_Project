/**
 * Financial ratios.
 *
 * Period convention (applies to every function here): flow items (revenue, EBIT, net income, COGS, FCF,
 * interest) and balance items must refer to the same period and the same currency/scale. The caller
 * chooses LTM, FY or NTM and whether balances are period-end or averages; the functions never mix
 * periods. Ratios come back as decimals (`ratio`, 0.25 = 25%), multiples (`multiple`, 2.5 = 2.5x) or `days`.
 */
import { assertFinite, assertNonNegative, assertPositive } from "./errors.ts";
import { type CalcResult, result } from "./result.ts";

function safeRatio(
  formulaId: string,
  numerator: number,
  numeratorName: string,
  denominator: number,
  denominatorName: string,
  unit: string,
  inputs: Record<string, unknown>,
): CalcResult<number> {
  assertFinite(numerator, numeratorName);
  assertPositive(denominator, denominatorName);
  return result(formulaId, numerator / denominator, unit, inputs);
}

/**
 * Gross margin = grossProfit / revenue.
 *
 * Units: currency in, `ratio` out. grossProfit may be negative (negative margin).
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if revenue ≤ 0; `NON_FINITE` on non-finite input.
 */
export function grossMargin(i: { grossProfit: number; revenue: number }): CalcResult<number> {
  return safeRatio("ratios.gross_margin", i.grossProfit, "grossProfit", i.revenue, "revenue", "ratio", {
    ...i,
  });
}

/**
 * EBIT margin = ebit / revenue.
 *
 * Units: currency in, `ratio` out. EBIT may be negative.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if revenue ≤ 0.
 */
export function ebitMargin(i: { ebit: number; revenue: number }): CalcResult<number> {
  return safeRatio("ratios.ebit_margin", i.ebit, "ebit", i.revenue, "revenue", "ratio", { ...i });
}

/**
 * EBITDA margin = ebitda / revenue.
 *
 * Units: currency in, `ratio` out. EBITDA may be negative.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if revenue ≤ 0.
 */
export function ebitdaMargin(i: { ebitda: number; revenue: number }): CalcResult<number> {
  return safeRatio("ratios.ebitda_margin", i.ebitda, "ebitda", i.revenue, "revenue", "ratio", { ...i });
}

/**
 * Net margin = netIncome / revenue.
 *
 * Units: currency in, `ratio` out. Net income may be negative.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if revenue ≤ 0.
 */
export function netMargin(i: { netIncome: number; revenue: number }): CalcResult<number> {
  return safeRatio("ratios.net_margin", i.netIncome, "netIncome", i.revenue, "revenue", "ratio", { ...i });
}

/**
 * Return on equity = netIncome / shareholdersEquity.
 *
 * Units: currency in, `ratio` out. Use average equity for a flow-over-balance match if desired.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if equity ≤ 0 (ROE on negative book equity is meaningless).
 */
export function returnOnEquity(i: { netIncome: number; shareholdersEquity: number }): CalcResult<number> {
  return safeRatio(
    "ratios.roe",
    i.netIncome,
    "netIncome",
    i.shareholdersEquity,
    "shareholdersEquity",
    "ratio",
    { ...i },
  );
}

/**
 * Return on assets = netIncome / totalAssets.
 *
 * Units: currency in, `ratio` out.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if totalAssets ≤ 0.
 */
export function returnOnAssets(i: { netIncome: number; totalAssets: number }): CalcResult<number> {
  return safeRatio("ratios.roa", i.netIncome, "netIncome", i.totalAssets, "totalAssets", "ratio", { ...i });
}

/**
 * Return on invested capital = NOPAT / investedCapital, where NOPAT = EBIT·(1 − t) computed by the caller.
 *
 * Units: currency in, `ratio` out. NOPAT may be negative.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if investedCapital ≤ 0.
 */
export function returnOnInvestedCapital(i: { nopat: number; investedCapital: number }): CalcResult<number> {
  return safeRatio("ratios.roic", i.nopat, "nopat", i.investedCapital, "investedCapital", "ratio", { ...i });
}

/**
 * Current ratio = currentAssets / currentLiabilities.
 *
 * Units: currency (balance sheet, same date) in, `multiple` out. currentAssets must be ≥ 0.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if currentLiabilities ≤ 0; `OUT_OF_RANGE` if currentAssets < 0.
 */
export function currentRatio(i: { currentAssets: number; currentLiabilities: number }): CalcResult<number> {
  assertNonNegative(i.currentAssets, "currentAssets");
  return safeRatio(
    "ratios.current_ratio",
    i.currentAssets,
    "currentAssets",
    i.currentLiabilities,
    "currentLiabilities",
    "multiple",
    { ...i },
  );
}

/**
 * Quick (acid-test) ratio = (cash + shortTermInvestments + receivables) / currentLiabilities.
 *
 * Uses the conservative "quick assets" definition (excludes inventory and prepaid items) rather than
 * (currentAssets − inventory). Units: currency (same balance-sheet date) in, `multiple` out.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if currentLiabilities ≤ 0; `OUT_OF_RANGE` if any asset < 0.
 */
export function quickRatio(i: {
  cash: number;
  shortTermInvestments: number;
  receivables: number;
  currentLiabilities: number;
}): CalcResult<number> {
  assertNonNegative(i.cash, "cash");
  assertNonNegative(i.shortTermInvestments, "shortTermInvestments");
  assertNonNegative(i.receivables, "receivables");
  return safeRatio(
    "ratios.quick_ratio",
    i.cash + i.shortTermInvestments + i.receivables,
    "quickAssets",
    i.currentLiabilities,
    "currentLiabilities",
    "multiple",
    { ...i },
  );
}

/**
 * Debt to equity = totalDebt / shareholdersEquity (book values unless the caller passes market values).
 *
 * Units: currency in, `multiple` out. totalDebt ≥ 0.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if equity ≤ 0; `OUT_OF_RANGE` if debt < 0.
 */
export function debtToEquity(i: { totalDebt: number; shareholdersEquity: number }): CalcResult<number> {
  assertNonNegative(i.totalDebt, "totalDebt");
  return safeRatio(
    "ratios.debt_to_equity",
    i.totalDebt,
    "totalDebt",
    i.shareholdersEquity,
    "shareholdersEquity",
    "multiple",
    { ...i },
  );
}

/**
 * Net debt / EBITDA = (totalDebt − cash) / ebitda.
 *
 * Units: currency in, `multiple` out. A negative result means net cash. Debt and cash are magnitudes (≥ 0).
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if EBITDA ≤ 0 (leverage on negative EBITDA is meaningless).
 */
export function netDebtToEbitda(i: { totalDebt: number; cash: number; ebitda: number }): CalcResult<number> {
  assertNonNegative(i.totalDebt, "totalDebt");
  assertNonNegative(i.cash, "cash");
  return safeRatio(
    "ratios.net_debt_to_ebitda",
    i.totalDebt - i.cash,
    "netDebt",
    i.ebitda,
    "ebitda",
    "multiple",
    {
      ...i,
    },
  );
}

/**
 * Interest coverage = ebit / interestExpense.
 *
 * Sign convention: interestExpense is a positive magnitude (an expense of 10 is passed as 10).
 * Units: currency in, `multiple` out. EBIT may be negative (coverage < 0).
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if interestExpense ≤ 0 (coverage is undefined with no interest).
 */
export function interestCoverage(i: { ebit: number; interestExpense: number }): CalcResult<number> {
  return safeRatio(
    "ratios.interest_coverage",
    i.ebit,
    "ebit",
    i.interestExpense,
    "interestExpense",
    "multiple",
    {
      ...i,
    },
  );
}

/**
 * Days sales outstanding = receivables / revenue × days.
 *
 * `days` is the length of the period the revenue covers (365 for annual FY/LTM; e.g. 91 for a quarter).
 * Units: currency in, `days` out. receivables ≥ 0.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if revenue ≤ 0 or days ≤ 0; `OUT_OF_RANGE` if receivables < 0.
 */
export function daysSalesOutstanding(i: {
  receivables: number;
  revenue: number;
  days?: number;
}): CalcResult<number> {
  const days = i.days ?? 365;
  assertPositive(days, "days");
  assertNonNegative(i.receivables, "receivables");
  assertPositive(i.revenue, "revenue");
  return result("ratios.dso", (i.receivables / i.revenue) * days, "days", { ...i, days });
}

/**
 * Days inventory outstanding = inventory / cogs × days.
 *
 * Sign convention: COGS is a positive magnitude. `days` is the period length (default 365).
 * Units: currency in, `days` out.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if cogs ≤ 0 or days ≤ 0; `OUT_OF_RANGE` if inventory < 0.
 */
export function daysInventoryOutstanding(i: {
  inventory: number;
  cogs: number;
  days?: number;
}): CalcResult<number> {
  const days = i.days ?? 365;
  assertPositive(days, "days");
  assertNonNegative(i.inventory, "inventory");
  assertPositive(i.cogs, "cogs");
  return result("ratios.dio", (i.inventory / i.cogs) * days, "days", { ...i, days });
}

/**
 * Days payables outstanding = payables / cogs × days.
 *
 * Sign convention: COGS is a positive magnitude. `days` is the period length (default 365).
 * Units: currency in, `days` out.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if cogs ≤ 0 or days ≤ 0; `OUT_OF_RANGE` if payables < 0.
 */
export function daysPayablesOutstanding(i: {
  payables: number;
  cogs: number;
  days?: number;
}): CalcResult<number> {
  const days = i.days ?? 365;
  assertPositive(days, "days");
  assertNonNegative(i.payables, "payables");
  assertPositive(i.cogs, "cogs");
  return result("ratios.dpo", (i.payables / i.cogs) * days, "days", { ...i, days });
}

/**
 * Cash conversion cycle = DSO + DIO − DPO, each computed with the same `days` (default 365).
 *
 * Units: currency in, `days` out. May be negative (supplier-financed working capital).
 * @throws FinanceInputError as for {@link daysSalesOutstanding}, {@link daysInventoryOutstanding} and
 *   {@link daysPayablesOutstanding}.
 */
export function cashConversionCycle(i: {
  receivables: number;
  inventory: number;
  payables: number;
  revenue: number;
  cogs: number;
  days?: number;
}): CalcResult<number> {
  const days = i.days ?? 365;
  const dso = daysSalesOutstanding({ receivables: i.receivables, revenue: i.revenue, days }).value;
  const dio = daysInventoryOutstanding({ inventory: i.inventory, cogs: i.cogs, days }).value;
  const dpo = daysPayablesOutstanding({ payables: i.payables, cogs: i.cogs, days }).value;
  return result("ratios.ccc", dso + dio - dpo, "days", { ...i, days, dso, dio, dpo });
}

/**
 * FCF conversion = freeCashFlow / netIncome.
 *
 * Units: currency in, `ratio` out. FCF may be negative.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if netIncome ≤ 0 (conversion of a loss is meaningless).
 */
export function fcfConversion(i: { freeCashFlow: number; netIncome: number }): CalcResult<number> {
  return safeRatio(
    "ratios.fcf_conversion",
    i.freeCashFlow,
    "freeCashFlow",
    i.netIncome,
    "netIncome",
    "ratio",
    {
      ...i,
    },
  );
}
