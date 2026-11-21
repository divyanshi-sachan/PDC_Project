import { describe, expect, it } from "vitest";
import { createMarketClient } from "./client.ts";

describe("market data (live, opt-in)", () => {
  const key = process.env.FMP_API_KEY;

  it.skipIf(!key)("fetches AAPL quote and the 10Y yield", async () => {
    const c = createMarketClient({ fmpApiKey: key ?? "" });
    const q = await c.quote("AAPL");
    expect(q.price).toBeGreaterThan(0);
    const r = await c.riskFreeRate();
    expect(r.tenYear).toBeGreaterThan(0);
    expect(r.tenYear).toBeLessThan(0.2);
  });
});
