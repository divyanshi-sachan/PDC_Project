import { describe, expect, it } from "vitest";
import { MarketDataError } from "./errors.ts";
import { fakeFetch, fixture, NOW } from "./testutil.ts";
import { fetchTenYearYield, parseTreasuryCsv } from "./treasury.ts";

describe("parseTreasuryCsv", () => {
  it("parses the real fixture (latest row, percent to decimal)", () => {
    const r = parseTreasuryCsv(fixture("treasury-daily-par-yield.csv"));
    expect(r?.date).toBe("2026-11-20");
    expect(r?.tenYear).toBeCloseTo(0.0492, 6);
  });

  it("ignores a trailing empty row and CRLF endings", () => {
    const csv = 'Date,"2 Yr","10 Yr"\r\n01/02/2026,3.5,4.1\r\n\r\n,,\r\n';
    const r = parseTreasuryCsv(csv);
    expect(r?.date).toBe("2026-01-02");
    expect(r?.tenYear).toBeCloseTo(0.041, 8);
  });

  it("skips newest rows with an empty 10 Yr and does not assume order", () => {
    const csv = 'Date,"10 Yr"\n01/05/2026,4.2\n01/07/2026,\n01/06/2026,4.3\n';
    const r = parseTreasuryCsv(csv);
    expect(r?.date).toBe("2026-01-06");
    expect(r?.tenYear).toBeCloseTo(0.043, 8);
  });

  it("returns null when no row has a 10 Yr value", () => {
    expect(parseTreasuryCsv('Date,"10 Yr"\n01/05/2026,\n')).toBeNull();
  });

  it("throws invalid_response when the 10 Yr column is missing", () => {
    expect(() => parseTreasuryCsv('Date,"2 Yr"\n01/05/2026,4.2\n')).toThrow(MarketDataError);
  });
});

describe("fetchTenYearYield", () => {
  it("returns evidence with the public URL", async () => {
    const f = fakeFetch(() => [200, fixture("treasury-daily-par-yield.csv")]);
    const r = await fetchTenYearYield({ fetch: f, now: NOW });
    expect(r.evidence.id).toBe("market:treasury:10y:2026-11-20");
    expect(r.evidence.section).toBe("treasury:10y");
    expect(r.sourceUrl).toContain("/2026/all");
    expect(JSON.stringify(r).toLowerCase()).not.toContain("apikey");
  });

  it("falls back to the prior year when the current year is empty", async () => {
    const f = fakeFetch((u) =>
      u.includes("/2027/") ? [200, 'Date,"10 Yr"\n'] : [200, 'Date,"10 Yr"\n12/31/2026,4.0\n'],
    );
    const r = await fetchTenYearYield({ fetch: f, now: () => new Date("2027-01-02T00:00:00Z") });
    expect(r.date).toBe("2026-12-31");
    expect(f.calls).toHaveLength(2);
  });

  it("maps HTTP failure", async () => {
    const f = fakeFetch(() => [503, ""]);
    await expect(fetchTenYearYield({ fetch: f, now: NOW })).rejects.toMatchObject({
      code: "upstream_error",
    });
  });
});
