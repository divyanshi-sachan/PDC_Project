import { describe, expect, it } from "vitest";
import { MarketDataError } from "./errors.ts";
import { createFmpClient, parseFmpBody } from "./fmp.ts";
import { fakeFetch, fixture, NOW } from "./testutil.ts";

const client = (status: number, body: string) => {
  const f = fakeFetch(() => [status, body]);
  return { f, c: createFmpClient({ apiKey: "SECRETKEY", fetch: f, now: NOW }) };
};

describe("fmp parsers on real fixtures", () => {
  it("parses quote", async () => {
    const { c } = client(200, fixture("fmp-quote-aapl.json"));
    const q = await c.quote("aapl");
    expect(q.symbol).toBe("AAPL");
    expect(q.price).toBeGreaterThan(0);
    expect(q.marketCap).toBeGreaterThan(1e12);
    expect(q.sharesOutstanding).toBeNull();
    expect(q.evidence.id).toBe("market:fmp:quote:AAPL:2026-11-21");
    expect(q.evidence.section).toBe("fmp:quote");
    expect(q.evidence.kind).toBe("market_data");
    expect(q.evidence.url).toBe("https://financialmodelingprep.com/stable/quote?symbol=AAPL");
  });

  it("parses profile", async () => {
    const { c } = client(200, fixture("fmp-profile-aapl.json"));
    const p = await c.profile("AAPL");
    expect(p.companyName).toBe("Apple Inc.");
    expect(p.beta).toBeCloseTo(1.089, 3);
    expect(p.sector).toBe("Technology");
    expect(p.currency).toBe("USD");
    expect(p.sharesOutstanding).toBeNull();
    expect(p.evidence.section).toBe("fmp:profile");
  });

  it("parses peers", async () => {
    const { c } = client(200, fixture("fmp-peers-aapl.json"));
    const p = await c.peers("AAPL");
    expect(p.peers).toHaveLength(4);
    expect(p.peers[0]).toBe("002241.SZ");
  });

  it("never puts the api key in evidence", async () => {
    const { c, f } = client(200, fixture("fmp-quote-aapl.json"));
    const q = await c.quote("AAPL");
    expect(JSON.stringify(q).toLowerCase()).not.toContain("apikey");
    expect(JSON.stringify(q)).not.toContain("SECRETKEY");
    expect(f.calls[0]).toContain("apikey=SECRETKEY");
  });
});

describe("fmp error mapping", () => {
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(MarketDataError);
      return (e as MarketDataError).code;
    }
    return "no-error";
  };

  it("plan-limited error body with 200", async () => {
    const { c } = client(
      200,
      JSON.stringify({ "Error Message": "Premium Endpoint: upgrade your subscription" }),
    );
    expect(await code(c.peers("AAPL"))).toBe("plan_limited");
  });
  it("plan-limited plain text with 402", async () => {
    const { c } = client(
      402,
      "Premium Query Parameter: symbol not available under your current subscription",
    );
    expect(await code(c.quote("ZZZZ"))).toBe("plan_limited");
  });
  it("limit-reached body is rate_limited", async () => {
    const { c } = client(200, JSON.stringify({ "Error Message": "Limit Reach . Please upgrade" }));
    expect(await code(c.quote("AAPL"))).toBe("rate_limited");
  });
  it("empty array is not_found", async () => {
    const { c } = client(200, "[]");
    expect(await code(c.profile("NOPE"))).toBe("not_found");
  });
  it("429 is rate_limited", async () => {
    const { c } = client(429, "");
    expect(await code(c.quote("AAPL"))).toBe("rate_limited");
  });
  it("500 is upstream_error", async () => {
    const { c } = client(500, "boom");
    expect(await code(c.quote("AAPL"))).toBe("upstream_error");
  });
  it("bad JSON is invalid_response", async () => {
    const { c } = client(200, "{not json");
    expect(await code(c.quote("AAPL"))).toBe("invalid_response");
  });
  it("schema mismatch is invalid_response", async () => {
    const { c } = client(200, JSON.stringify([{ symbol: "AAPL", price: "x" }]));
    expect(await code(c.quote("AAPL"))).toBe("invalid_response");
  });
  it("network failure is upstream_error without leaking the key", async () => {
    const c = createFmpClient({
      apiKey: "SECRETKEY",
      now: NOW,
      fetch: async (u) => {
        throw new Error(`failed ${u}`);
      },
    });
    try {
      await c.quote("AAPL");
      expect.unreachable();
    } catch (e) {
      expect((e as MarketDataError).code).toBe("upstream_error");
      expect((e as Error).message).not.toContain("SECRETKEY");
    }
  });
  it("parseFmpBody rejects non-array objects", () => {
    expect(() => parseFmpBody(200, "{}", "x")).toThrow(MarketDataError);
  });
});
