import { dilutedSharesEstimate } from "@dealpilot/finance";
import type { LlmClient } from "@dealpilot/llm";
import type { Evidence, Panel } from "@dealpilot/shared";
import type { EdgarClient } from "@dealpilot/sources";
import { gatherHistory } from "../research/history.ts";
import { gatherPeerData } from "../research/peers.ts";
import type { CompanyHistory } from "../research/types.ts";
import { type AssumptionSet, baselineAssumptions, proposeAssumptions } from "./assumptions.ts";
import { runComps, type SelectedPeer, selectPeers } from "./comps.ts";
import { mergeOverrides, NO_OVERRIDES, type Overrides } from "./overrides.ts";
import { buildPanel } from "./panel.ts";
import { type AnalysisSnapshot, effectiveMarket } from "./snapshot.ts";
import { summarizeHistory, UnsupportedCompanyError } from "./summary.ts";
import { runValuation, ValuationError } from "./valuation.ts";

export * from "./assumptions.ts";
export * from "./comps.ts";
export * from "./marketview.ts";
export * from "./overrides.ts";
export * from "./panel.ts";
export * from "./snapshot.ts";
export * from "./summary.ts";
export * from "./valuation.ts";

/** The slice of the market client the modeling agent needs (the real `@dealpilot/market` client satisfies it). */
export interface QuoteExtra {
  priceAsOf: string;
  priceSource: string;
  sharesOutstanding: number;
  sharesAsOf: string;
  sharesSource: string;
  sharesEvidence: Evidence;
  warnings: string[];
}

export interface MarketApi {
  /**
   * Price and market cap. `opts.userPrice` is a price the user stated. `extra` carries the dated inputs behind a
   * computed market cap (price × SEC shares) when the market view provides them.
   */
  quote(
    symbol: string,
    opts?: { userPrice?: number },
  ): Promise<{ price: number; marketCap: number; evidence: Evidence; extra?: QuoteExtra }>;
  profile(symbol: string): Promise<{
    companyName: string;
    beta: number | null;
    sector: string | null;
    industry: string | null;
    evidence: Evidence;
  }>;
  peers(symbol: string): Promise<{ peers: string[]; evidence: Evidence }>;
  riskFreeRate(): Promise<{ tenYear: number; evidence: Evidence }>;
}

export interface ModelingDeps {
  llm: LlmClient;
  edgar: EdgarClient;
  market: MarketApi;
  /** Optional progress callback for long phases (peer gathering). */
  progress?: (label: string, detail?: string) => void | Promise<void>;
  now?: () => Date;
}

const DEFAULT_BETA = 1;

/** Run `fn` over `items` with at most `limit` in flight, preserving order; failures become `null`. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let k = next++; k < items.length; k = next++) {
        try {
          out[k] = await fn(items[k] as T);
        } catch {
          out[k] = null;
        }
      }
    }),
  );
  return out;
}

/** Fresh analysis: filings + market data + peers → snapshot. No valuation math here yet. */
export async function buildSnapshot(
  deps: ModelingDeps,
  ticker: string,
  prefetched?: CompanyHistory,
  opts: { userPrice?: number } = {},
): Promise<AnalysisSnapshot> {
  const now = (deps.now ?? (() => new Date()))();
  const history = prefetched ?? (await gatherHistory(deps.edgar, ticker));
  const [quote, profile, rf] = await Promise.all([
    deps.market.quote(ticker, opts.userPrice !== undefined ? { userPrice: opts.userPrice } : undefined),
    deps.market.profile(ticker),
    deps.market.riskFreeRate(),
  ]);
  const notes: string[] = [];
  const beta = profile.beta ?? DEFAULT_BETA;
  if (profile.beta === null) notes.push("Beta not available from the market data provider; assumed 1.0.");

  // Share count: SEC-reported (cover page) scaled by the dilution seen in the latest fiscal year.
  let dilutedSharesUsed: number | undefined;
  if (quote.extra) {
    const basic = history.items.basicShares?.[0]?.value;
    const diluted = history.items.dilutedShares?.[0]?.value;
    dilutedSharesUsed = quote.extra.sharesOutstanding;
    if (basic && diluted) {
      try {
        dilutedSharesUsed = dilutedSharesEstimate({
          coverShares: quote.extra.sharesOutstanding,
          weightedBasic: basic,
          weightedDiluted: diluted,
        }).value;
      } catch {
        notes.push(
          "Dilution adjustment skipped (implausible diluted/basic ratio); using the reported share count.",
        );
      }
    }
    notes.push(...quote.extra.warnings);
  }

  const summary = summarizeHistory(
    history,
    dilutedSharesUsed === undefined ? {} : { dilutedShares: dilutedSharesUsed },
  );
  const baseline = baselineAssumptions(summary, rf.tenYear);
  const proposal = await proposeAssumptions({
    llm: deps.llm,
    summary,
    baseline,
    sector: profile.sector,
    industry: profile.industry,
    riskFreeRate: rf.tenYear,
  });
  if (proposal.note) notes.push(proposal.note);

  // Peers: the model proposes US-listed comparables (provider list is only a hint); each is validated
  // against SEC filings + market data, and the first MAX_PEERS that load successfully are kept.
  const MAX_PEERS = 6;
  const peers: SelectedPeer[] = [];
  try {
    await deps.progress?.("Selecting comparable companies");
    const hints = await deps.market
      .peers(ticker)
      .then((p) => p.peers.slice(0, 15))
      .catch(() => []);
    const proposed = await selectPeers(deps.llm, {
      ticker,
      name: profile.companyName,
      sector: profile.sector,
      industry: profile.industry,
      hints,
    });
    await deps.progress?.(
      `Reading peer filings (up to ${MAX_PEERS} of ${proposed.length} candidates)`,
      proposed.map((c) => c.ticker).join(", "),
    );
    // Work down the ranked list in small batches until enough peers load; a symbol the market data plan
    // does not cover (or a company without SEC data) is skipped. Quotes are cached, so the pre-check is free.
    const failed: string[] = [];
    for (let k = 0; k < proposed.length && peers.length < MAX_PEERS; k += 3) {
      const batch = proposed.slice(k, k + 3);
      const loaded = await mapLimit(batch, 3, async (c): Promise<SelectedPeer> => {
        await deps.market.quote(c.ticker);
        return { data: await gatherPeerData(deps.edgar, deps.market, c.ticker), rationale: c.rationale };
      });
      loaded.forEach((p, j) => {
        if (p && peers.length < MAX_PEERS) peers.push(p);
        else if (!p) failed.push((batch[j] as { ticker: string }).ticker);
      });
    }
    if (failed.length)
      notes.push(`Skipped (no market or SEC data on the free data plan): ${failed.join(", ")}.`);
    if (peers.length < MAX_PEERS)
      notes.push(
        `Only ${peers.length} comparable compan${peers.length === 1 ? "y" : "ies"} could be loaded.`,
      );
  } catch (e) {
    notes.push(
      `Comparable companies unavailable (${e instanceof Error ? e.message.slice(0, 100) : "error"}).`,
    );
  }

  return {
    version: 1,
    ticker,
    companyName: history.company.name,
    cik: history.company.cik,
    asOf: now.toISOString(),
    history,
    market: {
      price: quote.price,
      marketCap: quote.marketCap,
      beta,
      riskFreeRate: rf.tenYear,
      sector: profile.sector,
      industry: profile.industry,
      evidence: [
        quote.evidence,
        profile.evidence,
        rf.evidence,
        ...(quote.extra ? [quote.extra.sharesEvidence] : []),
      ],
      ...(quote.extra
        ? {
            priceAsOf: quote.extra.priceAsOf,
            priceSource: quote.extra.priceSource,
            sharesOutstanding: quote.extra.sharesOutstanding,
            sharesAsOf: quote.extra.sharesAsOf,
            sharesSource: quote.extra.sharesSource,
            ...(dilutedSharesUsed === undefined ? {} : { dilutedSharesUsed }),
          }
        : {}),
    },
    assumptions: proposal.assumptions,
    assumptionsFromBaseline: proposal.usedFallback,
    peers,
    overrides: NO_OVERRIDES,
    notes: [...notes, ...summary.notes],
  };
}

function applyOverrides(snapshot: AnalysisSnapshot): { assumptions: AssumptionSet; beta: number } {
  const o = snapshot.overrides;
  const a = snapshot.assumptions;
  return {
    beta: o.beta ?? snapshot.market.beta,
    assumptions: {
      ...a,
      terminalGrowth: o.terminalGrowth ?? a.terminalGrowth,
      equityRiskPremium: o.equityRiskPremium ?? a.equityRiskPremium,
      revenueGrowth:
        o.revenueGrowthShift === null
          ? a.revenueGrowth
          : a.revenueGrowth.map((g) => g + (o.revenueGrowthShift as number)),
      ebitMargin:
        o.ebitMarginShift === null
          ? a.ebitMargin
          : a.ebitMargin.map((m) => m + (o.ebitMarginShift as number)),
    },
  };
}

/** Deterministic: valuation + comps + panel from a snapshot (with its accumulated overrides). */
export function computePanel(snapshot: AnalysisSnapshot): Panel {
  const m = snapshot.market;
  const summary = summarizeHistory(
    snapshot.history,
    m.dilutedSharesUsed === undefined ? {} : { dilutedShares: m.dilutedSharesUsed },
  );
  const { assumptions, beta } = applyOverrides(snapshot);
  // A user-stated price replaces the market price; market cap is recomputed (price × SEC shares).
  const eff = effectiveMarket(snapshot);
  const valuation = runValuation({
    summary,
    market: {
      price: eff.price,
      marketCap: eff.marketCap,
      beta,
      riskFreeRate: snapshot.market.riskFreeRate,
    },
    assumptions,
    ...(snapshot.overrides.wacc !== null ? { waccOverride: snapshot.overrides.wacc } : {}),
  });
  const ebit0 = snapshot.history.items.ebit?.[0]?.value ?? null;
  const da0 = snapshot.history.items.depreciationAndAmortization?.[0]?.value ?? 0;
  const comps = runComps(
    snapshot.peers,
    { summary, ebitda: ebit0 === null ? null : ebit0 + da0 },
    new Set(snapshot.overrides.excludePeers.map((t) => t.toUpperCase())),
  );
  return buildPanel(snapshot, summary, assumptions, valuation, comps);
}

/** Apply a follow-up's overrides to a stored snapshot and recompute. No network, no LLM. */
export function recompute(
  snapshot: AnalysisSnapshot,
  change: Overrides,
): { snapshot: AnalysisSnapshot; panel: Panel } {
  const next: AnalysisSnapshot = { ...snapshot, overrides: mergeOverrides(snapshot.overrides, change) };
  return { snapshot: next, panel: computePanel(next) };
}

export { UnsupportedCompanyError, ValuationError };
