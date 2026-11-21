import { z } from "zod";
import { MarketDataError } from "./errors.ts";
import { type FetchLike, marketEvidence, type Peers, type Profile, type Quote } from "./types.ts";

const BASE = "https://financialmodelingprep.com/stable";

const nullableNumber = z
  .number()
  .nullish()
  .transform((v) => v ?? null);
const nullableString = z
  .string()
  .nullish()
  .transform((v) => (v === undefined || v === null || v.trim() === "" ? null : v));

const RawQuote = z.object({
  symbol: z.string(),
  price: z.number(),
  marketCap: z.number(),
  sharesOutstanding: nullableNumber,
  currency: nullableString,
  timestamp: z.number().nullish(),
});
const RawProfile = z.object({
  symbol: z.string(),
  companyName: z.string(),
  beta: nullableNumber,
  sector: nullableString,
  industry: nullableString,
  exchange: z.string(),
  currency: nullableString,
  sharesOutstanding: nullableNumber,
  marketCap: nullableNumber,
});
const RawPeer = z.object({ symbol: z.string() });

function classifyMessage(message: string, status: number | null): MarketDataError {
  const m = message.toLowerCase();
  if (m.includes("limit reach") || m.includes("rate limit") || m.includes("too many")) {
    return new MarketDataError("rate_limited", "FMP rate limit reached", status);
  }
  if (
    m.includes("premium") ||
    m.includes("subscription") ||
    m.includes("not available") ||
    m.includes("upgrade")
  ) {
    return new MarketDataError("plan_limited", "FMP endpoint or symbol not available on this plan", status);
  }
  if (m.includes("invalid api key") || m.includes("apikey")) {
    return new MarketDataError("upstream_error", "FMP rejected the API key", status);
  }
  return new MarketDataError("upstream_error", `FMP error: ${message.slice(0, 200)}`, status);
}

/**
 * Parse an FMP response body into a non-empty array. Throws MarketDataError for
 * non-200s, error bodies returned with 200, non-JSON and empty arrays.
 */
export function parseFmpBody(status: number, text: string, what: string): unknown[] {
  if (status === 429) throw new MarketDataError("rate_limited", "FMP rate limit reached (HTTP 429)", 429);
  if (status === 402 || status === 403) throw classifyMessage(text || "premium", status);
  if (status === 404) throw new MarketDataError("not_found", `${what}: not found`, 404);
  if (status !== 200) throw new MarketDataError("upstream_error", `FMP HTTP ${status}`, status);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // FMP sometimes returns plain-text plan/limit messages with a 200.
    if (/premium|subscription|limit|upgrade/i.test(text)) throw classifyMessage(text, status);
    throw new MarketDataError("invalid_response", `${what}: response was not JSON`, status);
  }
  if (Array.isArray(json)) {
    if (json.length === 0) throw new MarketDataError("not_found", `${what}: empty result`, status);
    return json;
  }
  if (typeof json === "object" && json !== null) {
    const o = json as Record<string, unknown>;
    const msg = o["Error Message"] ?? o.message ?? o.error;
    if (typeof msg === "string") throw classifyMessage(msg, status);
  }
  throw new MarketDataError("invalid_response", `${what}: unexpected response shape`, status);
}

function parseWith<S extends z.ZodType>(schema: S, value: unknown, what: string): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new MarketDataError(
      "invalid_response",
      `${what}: schema mismatch (${r.error.issues[0]?.path.join(".") ?? "?"})`,
    );
  }
  return r.data;
}

export function parseQuote(body: unknown[], symbol: string, now: Date, url: string): Quote {
  const raw = parseWith(RawQuote, body[0], `quote ${symbol}`);
  const retrievedAt = now.toISOString();
  const asOf = raw.timestamp ? new Date(raw.timestamp * 1000).toISOString() : retrievedAt;
  return {
    symbol: raw.symbol,
    price: raw.price,
    marketCap: raw.marketCap,
    sharesOutstanding: raw.sharesOutstanding,
    currency: raw.currency,
    asOf,
    evidence: marketEvidence({
      id: `market:fmp:quote:${raw.symbol}:${retrievedAt.slice(0, 10)}`,
      url,
      section: "fmp:quote",
      retrievedAt,
    }),
  };
}

export function parseProfile(body: unknown[], symbol: string, now: Date, url: string): Profile {
  const raw = parseWith(RawProfile, body[0], `profile ${symbol}`);
  const retrievedAt = now.toISOString();
  return {
    ...raw,
    evidence: marketEvidence({
      id: `market:fmp:profile:${raw.symbol}:${retrievedAt.slice(0, 10)}`,
      url,
      section: "fmp:profile",
      retrievedAt,
    }),
  };
}

export function parsePeers(body: unknown[], symbol: string, now: Date, url: string): Peers {
  const peers = body.map((p) => parseWith(RawPeer, p, `peers ${symbol}`).symbol);
  const retrievedAt = now.toISOString();
  return {
    symbol,
    peers,
    evidence: marketEvidence({
      id: `market:fmp:peers:${symbol}:${retrievedAt.slice(0, 10)}`,
      url,
      section: "fmp:peers",
      retrievedAt,
    }),
  };
}

export interface FmpClientOptions {
  apiKey: string;
  fetch?: FetchLike;
  now?: () => Date;
}

export function createFmpClient(opts: FmpClientOptions) {
  const doFetch: FetchLike = opts.fetch ?? ((u, i) => fetch(u, i));
  const now = opts.now ?? (() => new Date());

  async function call(
    path: string,
    symbol: string,
    what: string,
  ): Promise<{ body: unknown[]; publicUrl: string }> {
    const publicUrl = `${BASE}/${path}?symbol=${encodeURIComponent(symbol)}`;
    let res: Response;
    let text: string;
    try {
      res = await doFetch(`${publicUrl}&apikey=${encodeURIComponent(opts.apiKey)}`, {
        headers: { Accept: "application/json" },
      });
      text = await res.text();
    } catch {
      // Deliberately drop the underlying error: it may embed the request URL (and key).
      throw new MarketDataError("upstream_error", `${what}: network failure`);
    }
    return { body: parseFmpBody(res.status, text, what), publicUrl };
  }

  const norm = (s: string) => s.trim().toUpperCase();

  return {
    async quote(symbol: string): Promise<Quote> {
      const s = norm(symbol);
      const { body, publicUrl } = await call("quote", s, `quote ${s}`);
      return parseQuote(body, s, now(), publicUrl);
    },
    async profile(symbol: string): Promise<Profile> {
      const s = norm(symbol);
      const { body, publicUrl } = await call("profile", s, `profile ${s}`);
      return parseProfile(body, s, now(), publicUrl);
    },
    async peers(symbol: string): Promise<Peers> {
      const s = norm(symbol);
      const { body, publicUrl } = await call("stock-peers", s, `peers ${s}`);
      return parsePeers(body, s, now(), publicUrl);
    },
  };
}
