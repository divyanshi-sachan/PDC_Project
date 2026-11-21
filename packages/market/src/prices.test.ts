import { describe, expect, test } from "vitest";
import { memoryCache } from "./cache.ts";
import { MarketDataError } from "./errors.ts";
import {
  cachedPriceProvider,
  chainPriceProviders,
  finnhubPriceProvider,
  type PricePoint,
  type PriceProvider,
  PriceUnavailableError,
  priceProvidersFromEnv,
  twelveDataPriceProvider,
  userPricePoint,
} from "./prices.ts";

const NOW = () => new Date("2026-11-21T15:00:00.000Z");
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function point(symbol: string, price: number, source: PricePoint["source"] = "fmp"): PricePoint {
  return {
    symbol,
    price,
    asOf: NOW().toISOString(),
    source,
    evidence: {
      id: `e:${symbol}`,
      kind: "market_data",
      accession: null,
      form: null,
      filed: null,
      url: "https://x.test",
      section: "t",
      quote: null,
      span: null,
      retrievedAt: NOW().toISOString(),
    },
  };
}
const ok = (name: string, price: number): PriceProvider => ({ name, price: async (s) => point(s, price) });
const failing = (name: string, code: "plan_limited" | "not_found" | "rate_limited"): PriceProvider => ({
  name,
  price: async () => {
    throw new MarketDataError(code, `${name} says ${code}`);
  },
});

describe("userPricePoint", () => {
  test("is labelled as user-provided and rejects non-positive prices", () => {
    const p = userPricePoint("HPQ", 38.5, NOW);
    expect(p).toMatchObject({ symbol: "HPQ", price: 38.5, source: "user", asOf: "2026-11-21T15:00:00.000Z" });
    expect(p.evidence.section).toBe("user:price");
    expect(() => userPricePoint("HPQ", 0, NOW)).toThrow(MarketDataError);
    expect(() => userPricePoint("HPQ", Number.NaN, NOW)).toThrow(MarketDataError);
  });
});

describe("chainPriceProviders", () => {
  test("first success wins; later providers are not called", async () => {
    let called = 0;
    const later: PriceProvider = {
      name: "later",
      price: async (s) => {
        called++;
        return point(s, 1);
      },
    };
    const p = await chainPriceProviders([failing("fmp", "plan_limited"), ok("finnhub", 101.5), later]).price(
      "HPQ",
    );
    expect(p.price).toBe(101.5);
    expect(called).toBe(0);
  });
  test("when everything fails the error says what was tried", async () => {
    const chain = chainPriceProviders([failing("fmp", "plan_limited"), failing("finnhub", "not_found")]);
    await expect(chain.price("ZZZZ")).rejects.toBeInstanceOf(PriceUnavailableError);
    await expect(chain.price("ZZZZ")).rejects.toThrow(/fmp: plan_limited; finnhub: not_found/);
  });
  test("an empty chain is a clear error, not a crash", async () => {
    await expect(chainPriceProviders([]).price("AAPL")).rejects.toThrow(/no providers configured/);
  });
});

describe("cachedPriceProvider", () => {
  test("serves a cached price without calling the provider, and never caches failures", async () => {
    let calls = 0;
    const inner: PriceProvider = {
      name: "x",
      price: async (s) => {
        calls++;
        return point(s, 50);
      },
    };
    const cached = cachedPriceProvider(inner, memoryCache(), 60);
    await cached.price("AAPL");
    await cached.price("AAPL");
    expect(calls).toBe(1);

    let failCalls = 0;
    const flaky: PriceProvider = {
      name: "flaky",
      price: async (s) => {
        if (failCalls++ === 0) throw new MarketDataError("upstream_error", "boom");
        return point(s, 9);
      },
    };
    const c2 = cachedPriceProvider(flaky, memoryCache(), 60);
    await expect(c2.price("A")).rejects.toThrow();
    expect((await c2.price("A")).price).toBe(9);
  });
});

describe("finnhubPriceProvider", () => {
  test("uses header auth (no key in the URL) and maps the quote", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const p = finnhubPriceProvider({
      apiKey: "SECRET",
      now: NOW,
      fetch: async (url, init) => {
        seen.push({
          url: String(url),
          headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
        });
        return json({ c: 38.25, d: 0.1, dp: 0.26, h: 39, l: 37.9, o: 38, pc: 38.15, t: 1763740800 });
      },
    });
    const pt = await p.price("HPQ");
    expect(pt).toMatchObject({ price: 38.25, source: "finnhub", asOf: "2025-11-21T16:00:00.000Z" });
    expect(seen[0]?.url).not.toMatch(/SECRET|token=/i);
    expect(seen[0]?.headers["X-Finnhub-Token"]).toBe("SECRET");
    expect(JSON.stringify(pt)).not.toMatch(/SECRET/);
  });
  test("zeros mean an unknown symbol; 429 and 401 map to typed errors", async () => {
    const mk = (res: () => Response) => finnhubPriceProvider({ apiKey: "k", fetch: async () => res() });
    await expect(mk(() => json({ c: 0, t: 0 })).price("NOPE")).rejects.toMatchObject({ code: "not_found" });
    await expect(mk(() => json({}, 429)).price("A")).rejects.toMatchObject({ code: "rate_limited" });
    await expect(mk(() => json({}, 401)).price("A")).rejects.toMatchObject({ code: "plan_limited" });
    await expect(mk(() => json({ nope: 1 })).price("A")).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("twelveDataPriceProvider", () => {
  test("parses the quote's close and trading date and uses header auth", async () => {
    let auth = "";
    const p = twelveDataPriceProvider({
      apiKey: "SECRET",
      now: NOW,
      fetch: async (_u, init) => {
        auth = String(((init?.headers ?? {}) as Record<string, string>).Authorization);
        // Shape captured live on 2026-11-21 (trimmed): the close is a string, datetime is a date.
        return json({ symbol: "HPQ", close: "27.96000", datetime: "2026-11-20", is_market_open: false });
      },
    });
    const pt = await p.price("HPQ");
    expect(pt.price).toBeCloseTo(27.96, 9);
    expect(pt.asOf).toBe("2026-11-20T00:00:00.000Z");
    expect(pt.evidence.section).toBe("twelvedata:quote");
    expect(auth).toBe("apikey SECRET");
    expect(JSON.stringify(pt)).not.toMatch(/SECRET/);
  });
  test("error bodies map to typed errors", async () => {
    const mk = (body: unknown, status = 200) =>
      twelveDataPriceProvider({ apiKey: "k", fetch: async () => json(body, status) });
    await expect(
      mk({ code: 400, message: "symbol not found", status: "error" }, 400).price("X"),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(mk({ code: 429, message: "limit", status: "error" }, 429).price("X")).rejects.toMatchObject({
      code: "rate_limited",
    });
    await expect(
      mk({ code: 401, message: "bad key", status: "error" }, 401).price("X"),
    ).rejects.toMatchObject({ code: "upstream_error" });
  });
});

describe("priceProvidersFromEnv", () => {
  test("skips providers whose key is missing and preserves the configured order", () => {
    const fmp = {
      quote: async () => {
        throw new Error("unused");
      },
    };
    const r = priceProvidersFromEnv(
      { PRICE_PROVIDERS: "finnhub, fmp ,twelvedata", FINNHUB_API_KEY: "k" },
      { fmp },
    );
    expect(r.providers.map((p) => p.name)).toEqual(["finnhub", "fmp"]);
    expect(r.skipped).toEqual(["twelvedata"]);
  });
});
