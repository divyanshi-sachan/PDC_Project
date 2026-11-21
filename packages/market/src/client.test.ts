import { describe, expect, it } from "vitest";
import { memoryCache } from "./cache.ts";
import { createMarketClient } from "./client.ts";
import { fakeFetch, fixture, NOW } from "./testutil.ts";

const route = (url: string): [number, string] => {
  if (url.includes("treasury.gov")) return [200, fixture("treasury-daily-par-yield.csv")];
  if (url.includes("/quote")) return [200, fixture("fmp-quote-aapl.json")];
  if (url.includes("/profile")) return [200, fixture("fmp-profile-aapl.json")];
  return [200, fixture("fmp-peers-aapl.json")];
};

describe("market client caching", () => {
  it("serves a repeat quote from cache without fetching", async () => {
    const f = fakeFetch(route);
    const c = createMarketClient({ fmpApiKey: "k", fetch: f, now: NOW });
    const a = await c.quote("AAPL");
    const b = await c.quote("aapl");
    expect(f.calls).toHaveLength(1);
    expect(b).toEqual(a);
  });

  it("caches treasury, profile and peers", async () => {
    const f = fakeFetch(route);
    const c = createMarketClient({ fmpApiKey: "k", fetch: f, now: NOW });
    await c.riskFreeRate();
    await c.riskFreeRate();
    await c.profile("AAPL");
    await c.profile("AAPL");
    await c.peers("AAPL");
    expect(f.calls).toHaveLength(3);
  });

  it("expires entries after their TTL (quote 15 min)", async () => {
    let t = Date.parse("2026-11-21T12:00:00Z");
    const f = fakeFetch(route);
    const c = createMarketClient({
      fmpApiKey: "k",
      fetch: f,
      now: () => new Date(t),
      cache: memoryCache(() => t),
    });
    await c.quote("AAPL");
    t += 14 * 60_000;
    await c.quote("AAPL");
    expect(f.calls).toHaveLength(1);
    t += 2 * 60_000;
    await c.quote("AAPL");
    expect(f.calls).toHaveLength(2);
  });

  it("treats a corrupt cache entry as a miss", async () => {
    const f = fakeFetch(route);
    const cache = memoryCache();
    await cache.set("fmp:quote", "AAPL", { nonsense: true }, 60);
    const c = createMarketClient({ fmpApiKey: "k", fetch: f, now: NOW, cache });
    await c.quote("AAPL");
    expect(f.calls).toHaveLength(1);
  });

  it("does not cache failures", async () => {
    let n = 0;
    const f = fakeFetch((u) => (++n === 1 ? [429, ""] : route(u)));
    const c = createMarketClient({ fmpApiKey: "k", fetch: f, now: NOW });
    await expect(c.quote("AAPL")).rejects.toMatchObject({ code: "rate_limited" });
    await expect(c.quote("AAPL")).resolves.toMatchObject({ symbol: "AAPL" });
  });

  it("no evidence URL contains apikey", async () => {
    const f = fakeFetch(route);
    const c = createMarketClient({ fmpApiKey: "SECRETKEY", fetch: f, now: NOW });
    const all = [
      await c.quote("AAPL"),
      await c.profile("AAPL"),
      await c.peers("AAPL"),
      await c.riskFreeRate(),
    ];
    for (const d of all) {
      expect(d.evidence.url).not.toMatch(/apikey/i);
      expect(d.evidence.url).not.toContain("SECRETKEY");
    }
  });
});
