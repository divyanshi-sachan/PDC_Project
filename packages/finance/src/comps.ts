/**
 * Trading comparables: per-peer multiples, summary statistics and the implied valuation range.
 *
 * Period convention: every peer's metrics must share one basis (all LTM, or all NTM, or all the same FY)
 * and the EV/equity values must be as of the same pricing date. The functions do not convert periods.
 */
import { assertFinite, assertPositive, FinanceInputError } from "./errors.ts";
import { type CalcResult, result, type Unit } from "./result.ts";

/**
 * EV / Revenue = enterpriseValue / revenue.
 *
 * Units: currency in, `multiple` out. A negative EV (net cash > market cap) gives a negative multiple.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if revenue ≤ 0.
 */
export function evToRevenue(i: { enterpriseValue: number; revenue: number }): CalcResult<number> {
  assertFinite(i.enterpriseValue, "enterpriseValue");
  assertPositive(i.revenue, "revenue");
  return result("comps.ev_revenue", i.enterpriseValue / i.revenue, "multiple", { ...i });
}

/**
 * EV / EBITDA = enterpriseValue / ebitda.
 *
 * Units: currency in, `multiple` out.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if EBITDA ≤ 0.
 */
export function evToEbitda(i: { enterpriseValue: number; ebitda: number }): CalcResult<number> {
  assertFinite(i.enterpriseValue, "enterpriseValue");
  assertPositive(i.ebitda, "ebitda");
  return result("comps.ev_ebitda", i.enterpriseValue / i.ebitda, "multiple", { ...i });
}

/**
 * EV / EBIT = enterpriseValue / ebit.
 *
 * Units: currency in, `multiple` out.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if EBIT ≤ 0.
 */
export function evToEbit(i: { enterpriseValue: number; ebit: number }): CalcResult<number> {
  assertFinite(i.enterpriseValue, "enterpriseValue");
  assertPositive(i.ebit, "ebit");
  return result("comps.ev_ebit", i.enterpriseValue / i.ebit, "multiple", { ...i });
}

/**
 * P / E = equityValue / netIncome (equivalently price / EPS on a consistent share basis).
 *
 * Units: currency in, `multiple` out. equityValue is market capitalisation.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if netIncome ≤ 0 (P/E of a loss is not meaningful).
 */
export function priceToEarnings(i: { equityValue: number; netIncome: number }): CalcResult<number> {
  assertFinite(i.equityValue, "equityValue");
  assertPositive(i.netIncome, "netIncome");
  return result("comps.pe", i.equityValue / i.netIncome, "multiple", { ...i });
}

/** Which multiple to compute. */
export type MultipleKind = "evRevenue" | "evEbitda" | "evEbit" | "pe";

/** One peer's market values and financials (same currency, scale and period basis). */
export interface PeerFinancials {
  name: string;
  enterpriseValue: number;
  equityValue: number;
  revenue: number;
  ebitda: number;
  ebit: number;
  netIncome: number;
}

/** A labelled observation for {@link summaryStats}. */
export interface Observation {
  name: string;
  value: number;
}

/** Why a peer was left out of the statistics. */
export type ExclusionReason = "non_finite" | "non_positive_denominator";

/** A peer excluded from the statistics, with the reason. */
export interface Exclusion {
  name: string;
  reason: ExclusionReason;
}

/** Summary statistics of the included observations. */
export interface SummaryStats {
  n: number;
  min: number;
  p25: number;
  median: number;
  mean: number;
  p75: number;
  max: number;
  included: Observation[];
  excluded: Exclusion[];
}

/** Inclusive percentile on a sorted array (Excel PERCENTILE.INC / QUARTILE.INC): rank h = p·(n − 1). */
function percentileInc(sorted: readonly number[], p: number): number {
  const h = p * (sorted.length - 1);
  const lo = Math.floor(h);
  const a = sorted[lo] ?? Number.NaN;
  const b = sorted[Math.min(lo + 1, sorted.length - 1)] ?? Number.NaN;
  return a + (h - lo) * (b - a);
}

/**
 * Summary statistics: n, min, p25, median, mean, p75, max.
 *
 * Percentiles use linear interpolation with rank p·(n − 1), matching Excel `PERCENTILE.INC`/`QUARTILE.INC`.
 * Non-finite observations are excluded and listed in `excluded` with reason `non_finite`.
 * Units: the observations' unit, passed as `unit` (default `multiple`); n is a count.
 * @param unit - Unit of the observations and of every statistic except n, e.g. `ratio` for margins.
 * @throws FinanceInputError `EMPTY_INPUT` if no finite observations remain.
 */
export function summaryStats(
  observations: readonly Observation[],
  unit: Unit = "multiple",
): CalcResult<SummaryStats> {
  return result("comps.summary_stats", computeStats(observations, []), unit, {
    observations: observations.map((o) => ({ ...o })),
  });
}

function computeStats(observations: readonly Observation[], priorExclusions: Exclusion[]): SummaryStats {
  const excluded = [...priorExclusions];
  const included: Observation[] = [];
  for (const o of observations) {
    if (Number.isFinite(o.value)) included.push({ name: o.name, value: o.value });
    else excluded.push({ name: o.name, reason: "non_finite" });
  }
  if (included.length === 0) {
    throw new FinanceInputError("EMPTY_INPUT", "no finite observations left to summarise");
  }
  const sorted = included.map((o) => o.value).sort((a, b) => a - b);
  const mean = sorted.reduce((acc, v) => acc + v, 0) / sorted.length;
  return {
    n: sorted.length,
    min: sorted[0] ?? Number.NaN,
    p25: percentileInc(sorted, 0.25),
    median: percentileInc(sorted, 0.5),
    mean,
    p75: percentileInc(sorted, 0.75),
    max: sorted[sorted.length - 1] ?? Number.NaN,
    included,
    excluded,
  };
}

const NUMERATOR: Record<MultipleKind, "enterpriseValue" | "equityValue"> = {
  evRevenue: "enterpriseValue",
  evEbitda: "enterpriseValue",
  evEbit: "enterpriseValue",
  pe: "equityValue",
};

const DENOMINATOR: Record<MultipleKind, "revenue" | "ebitda" | "ebit" | "netIncome"> = {
  evRevenue: "revenue",
  evEbitda: "ebitda",
  evEbit: "ebit",
  pe: "netIncome",
};

/**
 * Computes one multiple for every peer and summarises it with {@link summaryStats}.
 *
 * multiple = numerator / denominator, where numerator is EV (EV/Revenue, EV/EBITDA, EV/EBIT) or equity
 * value (P/E). A peer is excluded (and reported in `excluded`) when its numerator or denominator is
 * non-finite (`non_finite`) or its denominator is ≤ 0 (`non_positive_denominator`). Negative-EV peers with a
 * positive denominator are kept. Units: `multiple`.
 * @throws FinanceInputError `EMPTY_INPUT` if no peer survives the exclusions.
 */
export function peerMultipleStats(
  peers: readonly PeerFinancials[],
  kind: MultipleKind,
): CalcResult<SummaryStats> {
  const num = NUMERATOR[kind];
  const den = DENOMINATOR[kind];
  const excluded: Exclusion[] = [];
  const observations: Observation[] = [];
  for (const p of peers) {
    const n = p[num];
    const d = p[den];
    if (!Number.isFinite(n) || !Number.isFinite(d)) excluded.push({ name: p.name, reason: "non_finite" });
    else if (d <= 0) excluded.push({ name: p.name, reason: "non_positive_denominator" });
    else observations.push({ name: p.name, value: n / d });
  }
  return result("comps.peer_stats", computeStats(observations, excluded), "multiple", {
    kind,
    peers: peers.map((p) => ({ ...p })),
  });
}

/** Implied valuation range for the target. */
export interface ImpliedRange {
  /** Whether the values are enterprise or equity values (P/E implies equity value). */
  basis: "enterpriseValue" | "equityValue";
  low: number;
  mid: number;
  high: number;
}

/**
 * Implied valuation range: low = p25 × metric, mid = median × metric, high = p75 × metric.
 *
 * `targetMetric` is the target's revenue / EBITDA / EBIT / net income on the **same period basis** as the
 * peers. EV multiples imply an enterprise value; P/E implies an equity value (`basis`).
 * Units: `multiple` × currency → currency.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if targetMetric ≤ 0 (a multiple of a non-positive
 *   metric is meaningless); `NON_FINITE` on non-finite quartiles.
 */
export function impliedValuationRange(i: {
  kind: MultipleKind;
  targetMetric: number;
  stats: Pick<SummaryStats, "p25" | "median" | "p75">;
}): CalcResult<ImpliedRange> {
  assertPositive(i.targetMetric, "targetMetric");
  assertFinite(i.stats.p25, "stats.p25");
  assertFinite(i.stats.median, "stats.median");
  assertFinite(i.stats.p75, "stats.p75");
  return result(
    "comps.implied_range",
    {
      basis: NUMERATOR[i.kind],
      low: i.stats.p25 * i.targetMetric,
      mid: i.stats.median * i.targetMetric,
      high: i.stats.p75 * i.targetMetric,
    },
    "currency",
    {
      kind: i.kind,
      targetMetric: i.targetMetric,
      p25: i.stats.p25,
      median: i.stats.median,
      p75: i.stats.p75,
    },
  );
}
