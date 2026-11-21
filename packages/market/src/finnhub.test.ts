import { describe, expect, test } from "vitest";
import { memoryCache } from "./cache.ts";
import { createFinnhubClient } from "./finnhub.ts";

const NOW = () => new Date("2026-11-21T15:00:00.000Z");
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Shapes captured from live responses on 2026-11-21 (trimmed). */
const PROFILE_HPQ = {
  country: "US",
  exchange: "NEW YORK STOCK EXCHANGE, INC.",
  finnhubIndustry: "Technology",
  marketCapitalization: 25214.07651980014,
  name: "HP Inc",
  shareOutstanding: 901.79,
  ticker: "HPQ",
};
const PEERS_HPQ = ["DELL", "WDC", "HPE", "NTAP", "P", "HPQ", "SMCI", "SNDK", "GPGI", "DBD", "INFQ", "AAPL"];
const METRIC_HPQ = { metric: { beta: 1.1979566, "52WeekHigh": 36.225 }, series: {} };

function client(
  routes: Record<string, () => Response>,
  seen: { url: string; headers: Record<string, string> }[] = [],
) {
  return createFinnhubClient({
    apiKey: "SECRET",
    now: NOW,
    cache: memoryCache(),
    fetch: async (url, init) => {
      const u = String(url);
      seen.push({
        url: u,
        headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      });
      const route = Object.entries(routes).find(([k]) => u.includes(k));
      if (!route) throw new Error(`unexpected url ${u}`);
      return route[1]();
    },
  });
}

describe("createFinnhubClient", () => {
  test("peers: removes the symbol itself and uses header auth (no key in URL or evidence)", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const c = client({ "/stock/peers": () => json(PEERS_HPQ) }, seen);
    const r = await c.peers("HPQ");
    expect(r.peers).toEqual([
      "DELL",
      "WDC",
      "HPE",
      "NTAP",
      "P",
      "SMCI",
      "SNDK",
      "GPGI",
      "DBD",
      "INFQ",
      "AAPL",
    ]);
    expect(seen[0]?.url).not.toMatch(/SECRET|token/i);
    expect(seen[0]?.headers["X-Finnhub-Token"]).toBe("SECRET");
    expect(JSON.stringify(r)).not.toMatch(/SECRET/);
    expect(r.evidence.section).toBe("finnhub:stock:peers");
  });

  test("profile: converts millions to units and keeps vendor figures labelled as vendor values", async () => {
    const p = await client({ "/stock/profile2": () => json(PROFILE_HPQ) }).profile("HPQ");
    expect(p).toMatchObject({ companyName: "HP Inc", industry: "Technology" });
    expect(p.vendorMarketCap).toBeCloseTo(25_214_076_519.8, -1);
    expect(p.vendorShares).toBeCloseTo(901_790_000, 0);
  });

  test("profile: an empty object means an unknown symbol", async () => {
    await expect(client({ "/stock/profile2": () => json({}) }).profile("ZZZZ")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  test("beta: reads metric.beta and tolerates a missing value", async () => {
    expect((await client({ "/stock/metric": () => json(METRIC_HPQ) }).beta("HPQ")).beta).toBeCloseTo(
      1.1979566,
      9,
    );
    expect((await client({ "/stock/metric": () => json({ metric: {} }) }).beta("X")).beta).toBeNull();
  });

  test("errors map to typed codes; bad shapes are invalid_response", async () => {
    await expect(client({ "/stock/peers": () => json({}, 429) }).peers("A")).rejects.toMatchObject({
      code: "rate_limited",
    });
    await expect(
      client({ "/stock/peers": () => json({ error: "Invalid API key" }, 401) }).peers("A"),
    ).rejects.toMatchObject({ code: "plan_limited" });
    await expect(
      client({ "/stock/peers": () => json({ not: "an array" }) }).peers("A"),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  test("results are cached: the second call does not hit the network", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const c = client({ "/stock/peers": () => json(PEERS_HPQ) }, seen);
    await c.peers("HPQ");
    await c.peers("HPQ");
    expect(seen).toHaveLength(1);
  });
});
