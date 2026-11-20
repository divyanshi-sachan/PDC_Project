import { FactSchema } from "@dealpilot/shared";
import { describe, expect, test } from "vitest";
import { createEdgarClient, EdgarServiceError, toFact, type XbrlFact } from "./client.ts";

const fact: XbrlFact = {
  concept: "us-gaap:Revenues",
  label: "Revenues",
  value: 391_035_000_000,
  unit: "USD",
  period_start: "2023-10-01",
  period_end: "2024-09-28",
  fiscal_year: 2024,
  fiscal_period: "FY",
  form: "10-K",
  accession: "0000320193-24-000123",
  filed: "2024-11-01",
  frame: "CY2024",
  restated: false,
  original_value: null,
};

function fakeFetch(status: number, body: unknown, seen: Request[] = []): typeof fetch {
  return async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    seen.push(req);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
}

describe("toFact", () => {
  test("maps provenance and passes the value through untouched", () => {
    const f = toFact("0000320193", fact, "2026-11-18T00:00:00Z");
    expect(FactSchema.parse(f)).toEqual(f);
    expect(f.value).toBe(391_035_000_000);
    expect(f.evidence.accession).toBe("0000320193-24-000123");
    expect(f.evidence.url).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/");
    expect(f.period).toEqual({
      start: "2023-10-01",
      end: "2024-09-28",
      fiscalYear: 2024,
      fiscalPeriod: "FY",
    });
  });

  test("unknown fiscal period from SEC becomes null, not a guess", () => {
    const f = toFact(
      "0000320193",
      { ...fact, fiscal_period: "CY", fiscal_year: null },
      "2026-11-18T00:00:00Z",
    );
    expect(f.period.fiscalPeriod).toBeNull();
    expect(f.period.fiscalYear).toBeNull();
  });
});

describe("createEdgarClient", () => {
  test("sends the service key and returns typed data", async () => {
    const seen: Request[] = [];
    const client = createEdgarClient({
      baseUrl: "http://edgar.test",
      serviceKey: "k",
      fetch: fakeFetch(200, { cik: "0000320193", concept: "us-gaap:Revenues", facts: [fact] }, seen),
    });
    const res = await client.facts("AAPL", { concept: "us-gaap:Revenues", form: "10-K" });
    expect(res.facts[0]?.accession).toBe(fact.accession);
    expect(seen[0]?.headers.get("x-service-key")).toBe("k");
    expect(seen[0]?.url).toBe("http://edgar.test/companies/AAPL/facts?concept=us-gaap%3ARevenues&form=10-K");
  });

  test("maps the service error envelope", async () => {
    const client = createEdgarClient({
      baseUrl: "http://edgar.test",
      fetch: fakeFetch(404, { error: { code: "not_found", message: "Unknown ticker ZZZZ" } }),
    });
    await expect(client.company("ZZZZ")).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(client.company("ZZZZ")).rejects.toBeInstanceOf(EdgarServiceError);
  });
});
