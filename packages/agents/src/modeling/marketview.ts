import { marketCap } from "@dealpilot/finance";
import { type MarketClient, type PriceProvider, userPricePoint } from "@dealpilot/market";
import type { Evidence } from "@dealpilot/shared";
import type { EdgarClient } from "@dealpilot/sources";
import { gatherShares } from "../research/shares.ts";
import type { MarketApi } from "./index.ts";

export interface MarketViewDeps {
  edgar: EdgarClient;
  /** Price source chain (or a single provider). */
  prices: PriceProvider;
  /** FMP client for profile / peers / Treasury yield. Profile and peers are best-effort. */
  fmp: Pick<MarketClient, "profile" | "peers" | "riskFreeRate">;
  now?: () => Date;
}

const edgarEvidence = (ticker: string, retrievedAt: string): Evidence => ({
  id: `market:edgar:company:${ticker}`,
  kind: "market_data",
  accession: null,
  form: null,
  filed: null,
  url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(ticker)}`,
  section: "edgar:company",
  quote: null,
  span: null,
  retrievedAt,
});

/**
 * DealPilot's market view. It rents ONE vendor number — the dated share price — and owns the rest:
 *   market cap = price × shares outstanding (SEC), computed by `@dealpilot/finance`.
 * Profile/peers from FMP are best-effort; when unavailable the company name and SIC come from EDGAR.
 */
export function createMarketView(deps: MarketViewDeps): MarketApi {
  const now = deps.now ?? (() => new Date());
  return {
    async quote(symbol, opts) {
      const point =
        opts?.userPrice !== undefined
          ? userPricePoint(symbol, opts.userPrice, now)
          : await deps.prices.price(symbol);
      const shares = await gatherShares(deps.edgar, symbol, { now });
      const cap = marketCap({ price: point.price, shares: shares.shares }).value;
      return {
        price: point.price,
        marketCap: cap,
        evidence: point.evidence,
        extra: {
          priceAsOf: point.asOf,
          priceSource: point.source,
          sharesOutstanding: shares.shares,
          sharesAsOf: shares.asOf,
          sharesSource: shares.source,
          sharesEvidence: shares.fact.evidence,
          warnings: shares.warnings,
        },
      };
    },

    async profile(symbol) {
      try {
        return await deps.fmp.profile(symbol);
      } catch {
        // FMP's free plan rejects some symbols; fall back to EDGAR for name/industry (no vendor beta).
        const c = await deps.edgar.company(symbol);
        return {
          companyName: c.name,
          beta: null,
          sector: null,
          industry: c.sic_description ?? null,
          evidence: edgarEvidence(symbol, now().toISOString()),
        };
      }
    },

    async peers(symbol) {
      try {
        return await deps.fmp.peers(symbol);
      } catch {
        return { peers: [], evidence: edgarEvidence(symbol, now().toISOString()) };
      }
    },

    riskFreeRate: () => deps.fmp.riskFreeRate(),
  };
}
