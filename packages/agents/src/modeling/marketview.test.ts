import { MarketDataError, type PriceProvider } from "@dealpilot/market";
import type { Evidence } from "@dealpilot/shared";
import { describe, expect, test } from "vitest";
import { company, fakeEdgar } from "../testkit.ts";
import { createMarketView } from "./marketview.ts";

const NOW = () => new Date("2026-11-21T15:00:00.000Z");
const ev = (section: string): Evidence => ({
  id: `e:${section}`,
  kind: "market_data",
  accession: null,
  form: null,
  filed: null,
  url: "https://x.test",
  section,
  quote: null,
  span: null,
  retrievedAt: NOW().toISOString(),
});

const prices = (map: Record<string, number>): PriceProvider => ({
  name: "fake",
  async price(symbol) {
    const price = map[symbol];
    if (price === undefined) throw new MarketDataError("plan_limited", "no price");
    return {
      symbol,
      price,
      asOf: "2026-11-20T21:00:00.000Z",
      source: "finnhub",
      evidence: ev("finnhub:quote"),
    };
  },
});

const fmp = (opts: { profile?: "ok" | "fail"; peers?: string[] | "fail" } = {}) => ({
  async profile(symbol: string) {
    if (opts.profile === "fail") throw new MarketDataError("plan_limited", "symbol not on plan");
    return {
      symbol,
      companyName: `${symbol} (fmp)`,
      beta: 1.1,
      sector: "Technology",
      industry: "Hardware",
      exchange: "NASDAQ",
      currency: "USD",
      sharesOutstanding: null,
      marketCap: null,
      evidence: ev("fmp:profile"),
    };
  },
  async peers(symbol: string) {
    if (opts.peers === "fail") throw new MarketDataError("plan_limited", "no");
    return { symbol, peers: opts.peers ?? ["FMPPEER"], evidence: ev("fmp:peers") };
  },
  async riskFreeRate() {
    return { date: "2026-11-20", tenYear: 0.0492, sourceUrl: "https://x.test", evidence: ev("treasury:10y") };
  },
});

const finnhub = (opts: { peers?: string[] | "fail"; profile?: "ok" | "fail" } = {}) => ({
  async peers(symbol: string) {
    if (opts.peers === "fail") throw new MarketDataError("rate_limited", "x");
    return { symbol, peers: opts.peers ?? ["FHPEER1", "FHPEER2"], evidence: ev("finnhub:stock:peers") };
  },
  async profile(symbol: string) {
    if (opts.profile === "fail") throw new MarketDataError("not_found", "x");
    return {
      symbol,
      companyName: `${symbol} Inc (finnhub)`,
      industry: "Technology",
      vendorMarketCap: 1,
      vendorShares: 1,
      evidence: ev("finnhub:stock:profile2"),
    };
  },
  async beta(symbol: string) {
    return { symbol, beta: 1.2, evidence: ev("finnhub:stock:metric") };
  },
});

const withDei = (c = company("TESTCO")) => ({
  ...c,
  series: { ...c.series, "dei:EntityCommonStockSharesOutstanding": [250e6, 255e6] },
});
const view = (
  o: {
    edgar?: ReturnType<typeof fakeEdgar>["client"];
    finnhub?: ReturnType<typeof finnhub>;
    fmp?: ReturnType<typeof fmp>;
    px?: Record<string, number>;
  } = {},
) =>
  createMarketView({
    edgar: o.edgar ?? fakeEdgar([withDei()]).client,
    prices: prices(o.px ?? { TESTCO: 40 }),
    fmp: o.fmp ?? fmp(),
    ...(o.finnhub ? { finnhub: o.finnhub } : {}),
    now: NOW,
  });

describe("quote: market cap is computed, not fetched", () => {
  test("market cap = price × SEC cover-page shares, with the dates and sources recorded", async () => {
    const q = await view().quote("TESTCO");
    expect(q.price).toBe(40);
    expect(q.marketCap).toBeCloseTo(40 * 250e6, 3); // $10bn
    expect(q.extra).toMatchObject({
      priceSource: "finnhub",
      priceAsOf: "2026-11-20T21:00:00.000Z",
      sharesOutstanding: 250e6,
      sharesSource: "cover_page",
      warnings: [],
    });
    expect(q.extra?.sharesEvidence.accession).toMatch(/^\d{10}-\d{2}-000001$/);
  });

  test("a user-stated price replaces the provider price and is labelled as the user's", async () => {
    const q = await view({ px: {} }).quote("TESTCO", { userPrice: 12.5 });
    expect(q.price).toBe(12.5);
    expect(q.marketCap).toBeCloseTo(12.5 * 250e6, 3);
    expect(q.extra?.priceSource).toBe("user");
  });

  test("when no cover-page or balance-sheet count exists, the weighted diluted count is used and flagged", async () => {
    const q = await view()
      .quote("TESTCO")
      .catch(() => null);
    expect(q).not.toBeNull();
    const multi = company("MULTI"); // no dei series → like Alphabet/Meta
    const m = await createMarketView({
      edgar: fakeEdgar([multi]).client,
      prices: prices({ MULTI: 10 }),
      fmp: fmp(),
      now: NOW,
    }).quote("MULTI");
    expect(m.extra?.sharesSource).toBe("weighted_diluted");
    expect(m.extra?.sharesOutstanding).toBe(100e6);
    expect(m.extra?.warnings.join(" ")).toMatch(/multiple share classes/);
    expect(m.marketCap).toBeCloseTo(10 * 100e6, 3);
  });

  test("a symbol no provider can price fails (the graph then asks the user for a price)", async () => {
    await expect(view().quote("NOPRICE")).rejects.toBeInstanceOf(MarketDataError);
  });
});

describe("profile fallback chain", () => {
  test("FMP first", async () => {
    expect((await view().profile("TESTCO")).companyName).toBe("TESTCO (fmp)");
  });
  test("FMP rejected → Finnhub profile with Finnhub beta", async () => {
    const p = await view({ fmp: fmp({ profile: "fail" }), finnhub: finnhub() }).profile("TESTCO");
    expect(p).toMatchObject({ companyName: "TESTCO Inc (finnhub)", beta: 1.2, industry: "Technology" });
  });
  test("both rejected → EDGAR name and SIC, no beta", async () => {
    const p = await view({ fmp: fmp({ profile: "fail" }), finnhub: finnhub({ profile: "fail" }) }).profile(
      "TESTCO",
    );
    expect(p).toMatchObject({ companyName: "TESTCO Corp", beta: null, industry: "Electronic Computers" });
  });
});

describe("peer hints", () => {
  test("Finnhub (US-focused) is preferred over FMP", async () => {
    expect((await view({ finnhub: finnhub() }).peers("TESTCO")).peers).toEqual(["FHPEER1", "FHPEER2"]);
  });
  test("falls back to FMP, then to an empty list", async () => {
    expect((await view({ finnhub: finnhub({ peers: "fail" }) }).peers("TESTCO")).peers).toEqual(["FMPPEER"]);
    expect(
      (await view({ finnhub: finnhub({ peers: [] }), fmp: fmp({ peers: "fail" }) }).peers("TESTCO")).peers,
    ).toEqual([]);
  });
});
