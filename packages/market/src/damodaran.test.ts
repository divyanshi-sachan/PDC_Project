import { describe, expect, test } from "vitest";
import { industryBetaTable, loadDamodaranBetas } from "./damodaran.ts";

describe("loadDamodaranBetas (committed snapshot)", () => {
  const t = loadDamodaranBetas();

  test("has the US industries with a source and a date", () => {
    expect(t.industries.length).toBeGreaterThanOrEqual(90);
    expect(t.source).toMatch(/^https:\/\/pages\.stern\.nyu\.edu\//);
    expect(t.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("lookup is case-insensitive and exposes unlevered betas that are positive and plausible", () => {
    const sw = t.find("software (system & application)");
    expect(sw?.name).toBe("Software (System & Application)");
    for (const i of t.industries) {
      expect(i.unleveredBetaCorrectedForCash).toBeGreaterThan(0.1);
      expect(i.unleveredBetaCorrectedForCash).toBeLessThan(3);
      expect(i.debtToEquity).toBeGreaterThanOrEqual(0);
    }
    expect(t.find("not an industry")).toBeUndefined();
    expect(t.names()).toContain("Total Market");
  });

  test("evidence cites the source, with the data date in the id and no key material", () => {
    const e = t.evidence("2026-11-21T00:00:00.000Z");
    expect(e).toMatchObject({ kind: "market_data", section: "damodaran:industry-betas" });
    expect(e.id).toContain(t.updated);
  });
});

describe("industryBetaTable validation", () => {
  test("rejects a malformed or too-small snapshot instead of silently using it", () => {
    expect(() => industryBetaTable({ nope: 1 })).toThrow();
    expect(() =>
      industryBetaTable({
        source: "https://x.test/a.xls",
        dataset: "d",
        updated: "2026-01-05",
        note: "n",
        industries: [],
      }),
    ).toThrow();
  });
});
