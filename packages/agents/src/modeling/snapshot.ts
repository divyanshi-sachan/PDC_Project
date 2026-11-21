import { marketCap as marketCapOf } from "@dealpilot/finance";
import type { Evidence } from "@dealpilot/shared";
import type { CompanyHistory } from "../research/types.ts";
import type { AssumptionSet } from "./assumptions.ts";
import type { SelectedPeer } from "./comps.ts";
import type { Overrides } from "./overrides.ts";
import type { MarketInputs } from "./valuation.ts";

/**
 * Everything needed to recompute a valuation with no network and no LLM:
 * cited filing facts, market inputs, the chosen assumptions, peers, and accumulated user overrides.
 * Persisted per thread (LangGraph checkpoint state).
 */
export interface AnalysisSnapshot {
  version: 1;
  ticker: string;
  companyName: string;
  cik: string;
  asOf: string;
  history: CompanyHistory;
  market: MarketInputs & {
    sector: string | null;
    industry: string | null;
    /** quote, profile, treasury and share-count evidence. */
    evidence: Evidence[];
    /** Provenance of the computed market cap (price × SEC shares). */
    priceAsOf?: string;
    priceSource?: string;
    sharesOutstanding?: number;
    sharesAsOf?: string;
    sharesSource?: string;
    /** Diluted share count used for per-share value (SEC count scaled by fiscal-year dilution). */
    dilutedSharesUsed?: number;
    /** How the beta was chosen (e.g. relevered Damodaran industry beta), shown beside the number. */
    betaBasis?: string;
  };
  assumptions: AssumptionSet;
  /** True when the baseline was used because the model's proposal was unavailable. */
  assumptionsFromBaseline: boolean;
  peers: SelectedPeer[];
  overrides: Overrides;
  notes: string[];
}

/**
 * The price and market cap the valuation should use: the stored market view, unless the user stated a price,
 * in which case market cap is recomputed as price × SEC shares by `@dealpilot/finance`.
 */
export function effectiveMarket(s: AnalysisSnapshot): {
  price: number;
  marketCap: number;
  priceFromUser: boolean;
} {
  const o = s.overrides.price;
  if (o === null)
    return {
      price: s.market.price,
      marketCap: s.market.marketCap,
      priceFromUser: s.market.priceSource === "user",
    };
  const shares = s.market.sharesOutstanding;
  return {
    price: o,
    marketCap: shares === undefined ? s.market.marketCap : marketCapOf({ price: o, shares }).value,
    priceFromUser: true,
  };
}
