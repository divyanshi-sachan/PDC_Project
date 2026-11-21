import type { z } from "zod";
import { memoryCache } from "./cache.ts";
import { createFmpClient } from "./fmp.ts";
import { fetchTenYearYield } from "./treasury.ts";
import {
  type FetchLike,
  type MarketCache,
  type Peers,
  PeersSchema,
  type Profile,
  ProfileSchema,
  type Quote,
  QuoteSchema,
  type RiskFreeRate,
  RiskFreeRateSchema,
} from "./types.ts";

export const TTL_SECONDS = {
  quote: 15 * 60,
  profile: 24 * 3600,
  peers: 24 * 3600,
  treasury: 6 * 3600,
} as const;

export interface MarketClientOptions {
  fmpApiKey: string;
  fetch?: FetchLike;
  cache?: MarketCache;
  now?: () => Date;
}

export function createMarketClient(opts: MarketClientOptions) {
  const now = opts.now ?? (() => new Date());
  const cache = opts.cache ?? memoryCache(() => now().getTime());
  const fmp = createFmpClient({ apiKey: opts.fmpApiKey, ...(opts.fetch ? { fetch: opts.fetch } : {}), now });

  async function cached<S extends z.ZodType>(
    ns: string,
    key: string,
    ttl: number,
    schema: S,
    load: () => Promise<z.infer<S>>,
  ): Promise<z.infer<S>> {
    const hit = schema.safeParse(await cache.get(ns, key));
    if (hit.success) return hit.data;
    const value = await load();
    await cache.set(ns, key, value, ttl);
    return value;
  }

  const sym = (s: string) => s.trim().toUpperCase();

  return {
    quote: (symbol: string): Promise<Quote> =>
      cached("fmp:quote", sym(symbol), TTL_SECONDS.quote, QuoteSchema, () => fmp.quote(symbol)),
    profile: (symbol: string): Promise<Profile> =>
      cached("fmp:profile", sym(symbol), TTL_SECONDS.profile, ProfileSchema, () => fmp.profile(symbol)),
    peers: (symbol: string): Promise<Peers> =>
      cached("fmp:peers", sym(symbol), TTL_SECONDS.peers, PeersSchema, () => fmp.peers(symbol)),
    riskFreeRate: (): Promise<RiskFreeRate> =>
      cached("treasury", "10y", TTL_SECONDS.treasury, RiskFreeRateSchema, () =>
        fetchTenYearYield({ ...(opts.fetch ? { fetch: opts.fetch } : {}), now }),
      ),
  };
}

export type MarketClient = ReturnType<typeof createMarketClient>;
