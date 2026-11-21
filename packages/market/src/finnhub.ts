/**
 * Finnhub reference data (free key, header auth so the key never appears in a URL):
 *  - `/stock/peers`     US-focused peer tickers (much better than FMP's list for large caps)
 *  - `/stock/profile2`  company name, industry label, market cap (USD millions) and shares outstanding (millions)
 *  - `/stock/metric`    company beta
 * Verified live on 2026-11-21 against the free tier for AAPL, HPQ, GOOGL and META. Prices are in `prices.ts`.
 *
 * Licensing: Finnhub's free plan is for personal use and bars redistributing data or derived results; see
 * docs/research/reports/FMP free plan coverage.md before showing vendor data on a public page.
 */
import type { Evidence } from "@dealpilot/shared";
import { z } from "zod";
import { MarketDataError } from "./errors.ts";
import { type MarketCache, marketEvidence } from "./types.ts";

type FetchLike = typeof fetch;

const Profile2 = z.object({
  name: z.string().optional(),
  finnhubIndustry: z.string().optional(),
  /** USD millions. */
  marketCapitalization: z.number().optional(),
  /** Millions of shares. */
  shareOutstanding: z.number().optional(),
});
const Peers = z.array(z.string());
const Metric = z.object({ metric: z.object({ beta: z.number().nullable().optional() }).passthrough() });

export interface FinnhubProfile {
  symbol: string;
  companyName: string;
  /** Finnhub's coarse industry label (e.g. "Technology", "Media"). */
  industry: string | null;
  /** Market cap in USD (converted from millions). Vendor figure: for reference only, never used in valuation. */
  vendorMarketCap: number | null;
  /** Shares outstanding (converted from millions). Vendor figure: SEC filings are the source of record. */
  vendorShares: number | null;
  evidence: Evidence;
}

export interface FinnhubClientOptions {
  apiKey: string;
  fetch?: FetchLike;
  cache?: MarketCache;
  now?: () => Date;
}

const TTL = { peers: 24 * 3600, profile: 24 * 3600, beta: 24 * 3600 } as const;

export function createFinnhubClient(opts: FinnhubClientOptions) {
  const f = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());

  async function get(path: string): Promise<unknown> {
    let res: Response;
    try {
      res = await f(`https://finnhub.io/api/v1${path}`, { headers: { "X-Finnhub-Token": opts.apiKey } });
    } catch {
      throw new MarketDataError("upstream_error", "finnhub request failed");
    }
    if (res.status === 429) throw new MarketDataError("rate_limited", "finnhub rate limit", 429);
    if (res.status === 401 || res.status === 403)
      throw new MarketDataError("plan_limited", "finnhub access denied", res.status);
    if (!res.ok) throw new MarketDataError("upstream_error", `finnhub HTTP ${res.status}`, res.status);
    return res.json().catch(() => {
      throw new MarketDataError("invalid_response", "finnhub returned invalid JSON");
    });
  }

  async function cached<T>(ns: string, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = await opts.cache?.get(ns, key);
    if (hit) return hit as T;
    const fresh = await load();
    await opts.cache?.set(ns, key, fresh, ttl);
    return fresh;
  }

  const ev = (section: string, symbol: string): Evidence => {
    const t = now().toISOString();
    return marketEvidence({
      id: `market:finnhub:${section}:${symbol}:${t.slice(0, 10)}`,
      url: `https://finnhub.io/api/v1/${section.replace(":", "/")}?symbol=${symbol}`,
      section: `finnhub:${section}`,
      retrievedAt: t,
    });
  };

  return {
    /** US-focused peer tickers (the symbol itself is removed). */
    peers: (symbol: string) =>
      cached("finnhub:peers", symbol, TTL.peers, async () => {
        const parsed = Peers.safeParse(await get(`/stock/peers?symbol=${encodeURIComponent(symbol)}`));
        if (!parsed.success)
          throw new MarketDataError("invalid_response", "unexpected finnhub peers response");
        return {
          symbol,
          peers: parsed.data.filter((t) => t.toUpperCase() !== symbol.toUpperCase()),
          evidence: ev("stock:peers", symbol),
        };
      }),

    /** Company profile. An unknown symbol returns an empty object upstream, mapped to `not_found`. */
    profile: (symbol: string): Promise<FinnhubProfile> =>
      cached("finnhub:profile", symbol, TTL.profile, async () => {
        const parsed = Profile2.safeParse(await get(`/stock/profile2?symbol=${encodeURIComponent(symbol)}`));
        if (!parsed.success)
          throw new MarketDataError("invalid_response", "unexpected finnhub profile response");
        if (!parsed.data.name) throw new MarketDataError("not_found", `finnhub has no profile for ${symbol}`);
        return {
          symbol,
          companyName: parsed.data.name,
          industry: parsed.data.finnhubIndustry ?? null,
          vendorMarketCap:
            parsed.data.marketCapitalization === undefined ? null : parsed.data.marketCapitalization * 1e6,
          vendorShares:
            parsed.data.shareOutstanding === undefined ? null : parsed.data.shareOutstanding * 1e6,
          evidence: ev("stock:profile2", symbol),
        };
      }),

    /** Company beta from Finnhub's basic financials (null when the metric is missing). */
    beta: (symbol: string) =>
      cached("finnhub:beta", symbol, TTL.beta, async () => {
        const parsed = Metric.safeParse(
          await get(`/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`),
        );
        if (!parsed.success)
          throw new MarketDataError("invalid_response", "unexpected finnhub metric response");
        return { symbol, beta: parsed.data.metric.beta ?? null, evidence: ev("stock:metric", symbol) };
      }),
  };
}

export type FinnhubClient = ReturnType<typeof createFinnhubClient>;
