/**
 * Share-price adapters. DealPilot rents ONE number per ticker (a dated price) and owns everything derived from
 * it (market cap, multiples) in `@dealpilot/finance`. Every provider implements `PriceProvider`, so swapping a
 * free tier for a licensed feed is a one-module change.
 *
 * Licensing: most free tiers are personal/internal use only. Which provider is enabled for a deployment is
 * configuration (`PRICE_PROVIDERS`); the public demo should prefer a user-confirmed price. See
 * docs/research/reports/FMP free plan coverage.md.
 */
import type { Evidence } from "@dealpilot/shared";
import { z } from "zod";
import type { MarketClient } from "./client.ts";
import { MarketDataError } from "./errors.ts";
import { type MarketCache, marketEvidence } from "./types.ts";

export type PriceSource = "fmp" | "finnhub" | "twelvedata" | "user";

export interface PricePoint {
  symbol: string;
  /** Price per share in USD. */
  price: number;
  /** When the price applies (ISO date-time). */
  asOf: string;
  source: PriceSource;
  evidence: Evidence;
}

export interface PriceProvider {
  readonly name: string;
  price(symbol: string): Promise<PricePoint>;
}

export class PriceUnavailableError extends Error {
  constructor(
    readonly symbol: string,
    readonly attempts: { provider: string; code: string; message: string }[],
  ) {
    super(
      `No share price available for ${symbol} (${attempts.map((a) => `${a.provider}: ${a.code}`).join("; ") || "no providers configured"})`,
    );
    this.name = "PriceUnavailableError";
  }
}

type FetchLike = typeof fetch;
const iso = (d: Date) => d.toISOString();

/** A price the user typed in. Never cached; always labelled as user-provided. */
export function userPricePoint(
  symbol: string,
  price: number,
  now: () => Date = () => new Date(),
): PricePoint {
  if (!(price > 0) || !Number.isFinite(price)) {
    throw new MarketDataError("invalid_response", "user-provided price must be a positive number");
  }
  const t = iso(now());
  return {
    symbol,
    price,
    asOf: t,
    source: "user",
    evidence: marketEvidence({
      id: `market:user:price:${symbol}:${t.slice(0, 10)}`,
      url: "user-provided",
      section: "user:price",
      retrievedAt: t,
    }),
  };
}

/** FMP quote as a price provider (free plan covers only an allow-list of ~87 symbols; others → plan_limited). */
export function fmpPriceProvider(client: Pick<MarketClient, "quote">): PriceProvider {
  return {
    name: "fmp",
    async price(symbol) {
      const q = await client.quote(symbol);
      return { symbol, price: q.price, asOf: q.asOf, source: "fmp", evidence: q.evidence };
    },
  };
}

const FinnhubQuote = z.object({ c: z.number(), t: z.number().optional() });

/**
 * Finnhub `/quote` (free key; header auth so the key never appears in a URL).
 * NOTE: written from the public API docs; not yet verified live (no key at the time of writing).
 * An unknown symbol returns zeros (`c: 0`), which is mapped to `not_found`.
 */
export function finnhubPriceProvider(opts: {
  apiKey: string;
  fetch?: FetchLike;
  now?: () => Date;
}): PriceProvider {
  const f = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  return {
    name: "finnhub",
    async price(symbol) {
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`;
      let res: Response;
      try {
        res = await f(url, { headers: { "X-Finnhub-Token": opts.apiKey } });
      } catch {
        throw new MarketDataError("upstream_error", "finnhub request failed");
      }
      if (res.status === 429) throw new MarketDataError("rate_limited", "finnhub rate limit", 429);
      if (res.status === 401 || res.status === 403)
        throw new MarketDataError("plan_limited", "finnhub access denied", res.status);
      if (!res.ok) throw new MarketDataError("upstream_error", `finnhub HTTP ${res.status}`, res.status);
      const parsed = FinnhubQuote.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw new MarketDataError("invalid_response", "unexpected finnhub response");
      if (parsed.data.c <= 0) throw new MarketDataError("not_found", `finnhub has no price for ${symbol}`);
      const at = parsed.data.t && parsed.data.t > 0 ? new Date(parsed.data.t * 1000) : now();
      const retrieved = iso(now());
      return {
        symbol,
        price: parsed.data.c,
        asOf: iso(at),
        source: "finnhub",
        evidence: marketEvidence({
          id: `market:finnhub:quote:${symbol}:${retrieved.slice(0, 10)}`,
          url: `https://finnhub.io/api/v1/quote?symbol=${symbol}`,
          section: "finnhub:quote",
          retrievedAt: retrieved,
        }),
      };
    },
  };
}

const TwelveDataPrice = z.union([
  z.object({ price: z.coerce.number() }),
  z.object({ status: z.literal("error"), code: z.number().optional(), message: z.string().optional() }),
]);

/**
 * Twelve Data `/price` (free Basic key; header auth). Price only, no timestamp, so `asOf` is retrieval time.
 * NOTE: written from the public API docs; not yet verified live (no key at the time of writing).
 */
export function twelveDataPriceProvider(opts: {
  apiKey: string;
  fetch?: FetchLike;
  now?: () => Date;
}): PriceProvider {
  const f = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  return {
    name: "twelvedata",
    async price(symbol) {
      const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}`;
      let res: Response;
      try {
        res = await f(url, { headers: { Authorization: `apikey ${opts.apiKey}` } });
      } catch {
        throw new MarketDataError("upstream_error", "twelvedata request failed");
      }
      if (res.status === 429) throw new MarketDataError("rate_limited", "twelvedata rate limit", 429);
      if (!res.ok && res.status !== 400 && res.status !== 404) {
        throw new MarketDataError("upstream_error", `twelvedata HTTP ${res.status}`, res.status);
      }
      const parsed = TwelveDataPrice.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw new MarketDataError("invalid_response", "unexpected twelvedata response");
      if ("status" in parsed.data) {
        const code =
          parsed.data.code === 429
            ? "rate_limited"
            : parsed.data.code === 401 || parsed.data.code === 403
              ? "plan_limited"
              : "not_found";
        throw new MarketDataError(code, `twelvedata: ${parsed.data.message?.slice(0, 80) ?? "error"}`);
      }
      if (!(parsed.data.price > 0))
        throw new MarketDataError("not_found", `twelvedata has no price for ${symbol}`);
      const t = iso(now());
      return {
        symbol,
        price: parsed.data.price,
        asOf: t,
        source: "twelvedata",
        evidence: marketEvidence({
          id: `market:twelvedata:price:${symbol}:${t.slice(0, 10)}`,
          url: `https://api.twelvedata.com/price?symbol=${symbol}`,
          section: "twelvedata:price",
          retrievedAt: t,
        }),
      };
    },
  };
}

/** Try providers in order; the first success wins. Failures are collected so the user sees what was tried. */
export function chainPriceProviders(providers: PriceProvider[]): PriceProvider {
  return {
    name: providers.map((p) => p.name).join("→") || "none",
    async price(symbol) {
      const attempts: { provider: string; code: string; message: string }[] = [];
      for (const p of providers) {
        try {
          return await p.price(symbol);
        } catch (e) {
          attempts.push({
            provider: p.name,
            code: e instanceof MarketDataError ? e.code : "error",
            message: e instanceof Error ? e.message.slice(0, 120) : "error",
          });
        }
      }
      throw new PriceUnavailableError(symbol, attempts);
    },
  };
}

/** Cache successful prices (including their original `asOf`). Failures are never cached. */
export function cachedPriceProvider(
  inner: PriceProvider,
  cache: MarketCache,
  ttlSeconds = 15 * 60,
): PriceProvider {
  const PricePointSchema = z.object({
    symbol: z.string(),
    price: z.number(),
    asOf: z.string(),
    source: z.enum(["fmp", "finnhub", "twelvedata", "user"]),
    evidence: z.any(),
  });
  return {
    name: inner.name,
    async price(symbol) {
      const hit = PricePointSchema.safeParse(await cache.get(`price:${inner.name}`, symbol));
      if (hit.success) return hit.data as PricePoint;
      const fresh = await inner.price(symbol);
      await cache.set(`price:${inner.name}`, symbol, fresh, ttlSeconds);
      return fresh;
    },
  };
}

/**
 * Build the provider chain from configuration, e.g. `PRICE_PROVIDERS=fmp,finnhub,twelvedata`.
 * Providers whose key is missing are skipped (and reported in `skipped`).
 */
export function priceProvidersFromEnv(
  env: {
    PRICE_PROVIDERS?: string | undefined;
    FINNHUB_API_KEY?: string | undefined;
    TWELVEDATA_API_KEY?: string | undefined;
  },
  deps: { fmp?: Pick<MarketClient, "quote">; fetch?: FetchLike; now?: () => Date },
): { providers: PriceProvider[]; skipped: string[] } {
  const wanted = (env.PRICE_PROVIDERS ?? "fmp,finnhub,twelvedata")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const providers: PriceProvider[] = [];
  const skipped: string[] = [];
  for (const name of wanted) {
    if (name === "fmp" && deps.fmp) providers.push(fmpPriceProvider(deps.fmp));
    else if (name === "finnhub" && env.FINNHUB_API_KEY)
      providers.push(
        finnhubPriceProvider({
          apiKey: env.FINNHUB_API_KEY,
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
          ...(deps.now ? { now: deps.now } : {}),
        }),
      );
    else if (name === "twelvedata" && env.TWELVEDATA_API_KEY)
      providers.push(
        twelveDataPriceProvider({
          apiKey: env.TWELVEDATA_API_KEY,
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
          ...(deps.now ? { now: deps.now } : {}),
        }),
      );
    else skipped.push(name);
  }
  return { providers, skipped };
}
