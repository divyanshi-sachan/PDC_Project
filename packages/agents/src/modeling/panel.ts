import type { Assumption, Evidence, Fact, Panel } from "@dealpilot/shared";
import type { HistoryItem } from "../research/types.ts";
import { type AssumptionSet, HORIZON_YEARS } from "./assumptions.ts";
import type { CompsOutput } from "./comps.ts";
import { type AnalysisSnapshot, effectiveMarket } from "./snapshot.ts";
import type { HistorySummary } from "./summary.ts";
import type { ValuationOutput } from "./valuation.ts";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const evidenceOf = (snapshot: AnalysisSnapshot, section: string): Evidence | undefined =>
  snapshot.market.evidence.find((e) => e.section === section);

/** Evidence sections that identify a share-price source. */
const PRICE_SECTIONS = new Set(["fmp:quote", "finnhub:quote", "twelvedata:price", "user:price"]);

const DAY_MS = 86_400_000;

/** Model notes: deterministic flags derived from the computed results (not LLM opinions). */
export function modelNotes(snapshot: AnalysisSnapshot, v: ValuationOutput, comps: CompsOutput) {
  const notes: Panel["risks"] = [];
  const share = v.terminalShareOfEv;
  if (share !== null && share > 0.75) {
    notes.push({
      title: "Terminal value dominates",
      detail: `${pct(share)} of enterprise value comes from the terminal value, so the result is highly sensitive to WACC and terminal growth (see the sensitivity table).`,
      evidenceIds: [],
    });
  }
  const spread = v.wacc - snapshot.assumptions.terminalGrowth;
  if (spread < 0.03) {
    notes.push({
      title: "Narrow WACC–growth spread",
      detail: `WACC (${pct(v.wacc)}) is only ${pct(spread)} above terminal growth (${pct(snapshot.assumptions.terminalGrowth)}); small changes move the value a lot.`,
      evidenceIds: [],
    });
  }
  const included = comps.rows.filter((r) => r.included).length;
  if (included < 4) {
    notes.push({
      title: "Few comparable companies",
      detail: `Only ${included} peer${included === 1 ? "" : "s"} contribute to the comps range, so treat it as indicative.`,
      evidenceIds: [],
    });
  }
  if (v.upsideVsPrice !== null && Math.abs(v.upsideVsPrice) > 0.5) {
    notes.push({
      title: "Large gap to market price",
      detail: `The DCF value differs from the market price by ${pct(Math.abs(v.upsideVsPrice))}. Check the growth and margin assumptions before relying on it.`,
      evidenceIds: [],
    });
  }
  const m = snapshot.market;
  if (m.sharesOutstanding !== undefined && m.priceAsOf && m.sharesAsOf) {
    const eff = effectiveMarket(snapshot);
    notes.push({
      title: "Market cap basis",
      detail: `Market cap = price ${eff.price.toFixed(2)} (${eff.priceFromUser ? "provided by you" : `${m.priceSource}, ${m.priceAsOf.slice(0, 10)}`}) × ${m.sharesOutstanding.toLocaleString("en-US")} shares (SEC ${(m.sharesSource ?? "").replace("_", " ")}, as of ${m.sharesAsOf}).`,
      evidenceIds: [],
    });
    const age = (Date.parse(snapshot.asOf) - Date.parse(m.priceAsOf)) / DAY_MS;
    if (snapshot.overrides.price === null && age > 4) {
      notes.push({
        title: "Stale price",
        detail: `The share price is ${Math.round(age)} days old (${m.priceAsOf.slice(0, 10)}); market cap and the WACC weights use it.`,
        evidenceIds: [],
      });
    }
  }
  if (snapshot.assumptionsFromBaseline) {
    notes.push({
      title: "Baseline assumptions used",
      detail: "Forecast assumptions come straight from recent filing averages (no model adjustments).",
      evidenceIds: [],
    });
  }
  for (const n of snapshot.notes) notes.push({ title: "Data note", detail: n, evidenceIds: [] });
  return notes;
}

/** Latest-year fact per item, for the evidence map and assumption citations. */
function latestFacts(snapshot: AnalysisSnapshot): Partial<Record<HistoryItem, Fact>> {
  const out: Partial<Record<HistoryItem, Fact>> = {};
  for (const [k, facts] of Object.entries(snapshot.history.items)) {
    if (facts?.[0]) out[k as HistoryItem] = facts[0];
  }
  return out;
}

export function buildPanel(
  snapshot: AnalysisSnapshot,
  summary: HistorySummary,
  a: AssumptionSet,
  v: ValuationOutput,
  comps: CompsOutput,
): Panel {
  const latest = latestFacts(snapshot);
  const evidence: Record<string, Evidence> = {};
  for (const f of Object.values(latest)) if (f) evidence[f.evidence.id] = f.evidence;
  for (const f of snapshot.history.items.revenue ?? []) evidence[f.evidence.id] = f.evidence;
  for (const e of snapshot.market.evidence) evidence[e.id] = e;
  for (const p of snapshot.peers) for (const e of p.data.evidence) evidence[e.id] = e;

  const ev = (k: HistoryItem) => latest[k]?.evidence.id ?? null;
  const eff = effectiveMarket(snapshot);
  const m = snapshot.market;
  const quoteEv = snapshot.market.evidence.find((e) => PRICE_SECTIONS.has(e.section ?? ""))?.id ?? null;
  const sharesEv = snapshot.market.evidence.find((e) => e.kind === "xbrl_fact")?.id ?? null;
  const day = (iso: string | undefined) => (iso ? iso.slice(0, 10) : "unknown date");
  const betaEv = evidenceOf(snapshot, "fmp:profile")?.id ?? null;
  const rfEv = evidenceOf(snapshot, "treasury:10y")?.id ?? null;
  const o = snapshot.overrides;

  const A = (
    key: string,
    label: string,
    value: number,
    unit: Assumption["unit"],
    source: Assumption["source"],
    evidenceId: string | null,
    rationale: string | null,
  ): Assumption => ({
    key,
    label,
    value,
    unit,
    source,
    evidenceId,
    rationale,
  });

  const assumptions: Assumption[] = [
    A(
      "revenue_base",
      "Base-year revenue",
      summary.latestRevenue,
      "usd",
      "filing",
      ev("revenue"),
      `Fiscal year ended ${summary.latestFiscalYearEnd}`,
    ),
    A(
      "diluted_shares",
      m.sharesOutstanding !== undefined ? "Diluted shares used" : "Diluted shares (weighted average)",
      summary.dilutedShares,
      "shares",
      "filing",
      m.sharesOutstanding !== undefined ? sharesEv : ev("dilutedShares"),
      m.sharesOutstanding !== undefined
        ? `SEC-reported count (${(m.sharesSource ?? "").replace("_", " ")}, as of ${day(m.sharesAsOf)}) scaled by the latest fiscal year's dilution`
        : "Latest fiscal year weighted average; buybacks since then are not reflected",
    ),
    A("total_debt", "Total debt", summary.totalDebt, "usd", "filing", ev("totalDebt"), null),
    A(
      "cash",
      "Cash and marketable securities",
      summary.cashAndInvestments,
      "usd",
      "filing",
      ev("cash"),
      null,
    ),
    A(
      "price",
      "Current share price",
      eff.price,
      "usd",
      eff.priceFromUser ? "assumption" : "market",
      eff.priceFromUser && o.price !== null ? null : quoteEv,
      o.price !== null
        ? "Provided by you"
        : `${m.priceSource ?? "market data"}, as of ${day(m.priceAsOf)}${m.priceSource === "user" ? " (provided by you)" : ""}`,
    ),
    A(
      "market_cap",
      "Market cap (price × SEC shares)",
      eff.marketCap,
      "usd",
      eff.priceFromUser ? "assumption" : "market",
      null,
      m.sharesOutstanding !== undefined
        ? `Computed by DealPilot from the share price and the SEC-reported share count of ${day(m.sharesAsOf)}`
        : "Provided by the market data source",
    ),
    A(
      "beta",
      "Equity beta",
      snapshot.market.beta,
      "ratio",
      o.beta !== null ? "assumption" : "market",
      betaEv,
      o.beta !== null ? "User override" : null,
    ),
    A(
      "risk_free",
      "Risk-free rate (10y Treasury)",
      snapshot.market.riskFreeRate,
      "pct",
      "market",
      rfEv,
      null,
    ),
    A(
      "erp",
      "Equity risk premium",
      a.equityRiskPremium,
      "pct",
      "assumption",
      null,
      o.equityRiskPremium !== null ? "User override" : a.rationale.other,
    ),
    A("pretax_cost_of_debt", "Pre-tax cost of debt", a.preTaxCostOfDebt, "pct", "assumption", null, null),
    A("tax_rate", "Tax rate", a.taxRate, "pct", "assumption", ev("incomeTaxExpense"), a.rationale.other),
    A(
      "da_pct",
      "D&A as % of revenue",
      a.daPctRevenue,
      "pct",
      "assumption",
      ev("depreciationAndAmortization"),
      null,
    ),
    A("capex_pct", "Capex as % of revenue", a.capexPctRevenue, "pct", "assumption", ev("capex"), null),
    A("nwc_pct", "NWC as % of revenue change", a.nwcPctOfRevenueChange, "pct", "assumption", null, null),
    A(
      "terminal_growth",
      "Terminal growth",
      a.terminalGrowth,
      "pct",
      "assumption",
      null,
      o.terminalGrowth !== null ? "User override" : null,
    ),
    ...a.revenueGrowth.map((g, k) =>
      A(
        `revenue_growth_y${k + 1}`,
        `Revenue growth, year ${k + 1}`,
        g,
        "pct",
        "assumption",
        null,
        k === 0 ? a.rationale.growth : null,
      ),
    ),
    ...a.ebitMargin.map((m, k) =>
      A(
        `ebit_margin_y${k + 1}`,
        `EBIT margin, year ${k + 1}`,
        m,
        "pct",
        "assumption",
        ev("ebit"),
        k === 0 ? a.rationale.margins : null,
      ),
    ),
  ];
  if (v.waccSource === "override") {
    assumptions.push(A("wacc", "WACC", v.wacc, "pct", "assumption", null, "User override"));
  }

  return {
    version: 1,
    ticker: snapshot.ticker,
    companyName: snapshot.companyName,
    cik: snapshot.cik,
    asOf: snapshot.asOf,
    currency: "USD",
    price: eff.price,
    marketCap: eff.marketCap,
    valuation: {
      method: "dcf_gordon",
      enterpriseValue: v.enterpriseValue,
      equityValue: v.equityValue,
      perShare: v.perShare,
      impliedUpsidePct: v.upsideVsPrice,
      terminalShareOfEv: v.terminalShareOfEv,
      wacc: v.wacc,
      terminalGrowth: a.terminalGrowth,
    },
    projection: v.projection.map((p) => ({
      year: Number(summary.latestFiscalYearEnd.slice(0, 4)) + p.index,
      revenue: p.revenue,
      ebit: p.ebit,
      ufcf: p.ufcf,
      discountFactor: p.discountFactor,
    })),
    comps: {
      peers: comps.rows,
      medianEvToEbitda: comps.medianEvToEbitda,
      medianEvToRevenue: comps.medianEvToRevenue,
      impliedPerShare: comps.impliedPerShare,
    },
    sensitivity: {
      title: "DCF value per share",
      rowLabel: "WACC",
      colLabel: "Terminal growth",
      rows: v.sensitivity.rows,
      cols: v.sensitivity.cols,
      values: v.sensitivity.values,
    },
    assumptions,
    risks: modelNotes(snapshot, v, comps),
    evidence,
    formulaIds: [...new Set([...v.formulaIds, ...comps.formulaIds])].sort(),
  };
}

export { HORIZON_YEARS };
