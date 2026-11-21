import { FactSchema } from "@dealpilot/shared";
import { type EdgarClient, EdgarServiceError, type XbrlFact } from "@dealpilot/sources";
import { describe, expect, test } from "vitest";
import { gatherHistory } from "./history.ts";
import { gatherPeerData } from "./peers.ts";

const CIK = "0001234567";
const accFor = (end: string) => `0001234567-${end.slice(2, 4)}-000001`;
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function dur(concept: string, end: string, value: number, o: Partial<XbrlFact> = {}): XbrlFact {
  return {
    concept: `us-gaap:${concept}`,
    label: concept,
    value,
    unit: "USD",
    period_start: addDays(end, -364),
    period_end: end,
    fiscal_year: Number(end.slice(0, 4)),
    fiscal_period: "FY",
    form: "10-K",
    accession: accFor(end),
    filed: addDays(end, 45),
    frame: null,
    restated: false,
    original_value: null,
    ...o,
  };
}
const inst = (concept: string, end: string, value: number, o: Partial<XbrlFact> = {}) =>
  dur(concept, end, value, { period_start: null, ...o });

function fakeEdgar(data: Record<string, XbrlFact[]>): EdgarClient & { calls: string[] } {
  const calls: string[] = [];
  const client = {
    calls,
    company: async () => ({
      cik: CIK,
      ticker: "ACME",
      name: "Acme Corp",
      sic: "3570",
      sic_description: "Computers",
      fiscal_year_end: "1231",
      exchanges: ["Nasdaq"],
    }),
    facts: async (_t: string, q: { concept: string }) => {
      calls.push(q.concept);
      const facts = data[q.concept];
      if (!facts) throw new EdgarServiceError(404, "not_found", `concept ${q.concept} not reported`);
      return { cik: CIK, concept: `us-gaap:${q.concept}`, facts };
    },
  };
  return client as unknown as EdgarClient & { calls: string[] };
}

const ENDS = ["2025-12-31", "2024-12-31", "2023-12-31"];
const series = (c: string, vals: number[], kind: "dur" | "inst" = "dur") =>
  ENDS.map((e, i) => (kind === "dur" ? dur(c, e, vals[i] ?? 0) : inst(c, e, vals[i] ?? 0)));

function baseData(): Record<string, XbrlFact[]> {
  return {
    RevenueFromContractWithCustomerExcludingAssessedTax: [
      ...series("RevenueFromContractWithCustomerExcludingAssessedTax", [300, 250, 200]),
      // quarterly facts mixed in (must be ignored)
      dur("RevenueFromContractWithCustomerExcludingAssessedTax", "2025-12-31", 80, {
        period_start: "2025-10-01",
        fiscal_period: "Q4",
      }),
      dur("RevenueFromContractWithCustomerExcludingAssessedTax", "2026-03-31", 90, {
        period_start: "2026-01-01",
        fiscal_period: "Q1",
      }),
    ],
    OperatingIncomeLoss: series("OperatingIncomeLoss", [60, 50, 40]),
    DepreciationDepletionAndAmortization: series("DepreciationDepletionAndAmortization", [10, 9, 8]),
    NetIncomeLoss: series("NetIncomeLoss", [45, 38, 30]),
    CashAndCashEquivalentsAtCarryingValue: series(
      "CashAndCashEquivalentsAtCarryingValue",
      [20, 18, 15],
      "inst",
    ),
    LongTermDebt: series("LongTermDebt", [100, 110, 120], "inst"),
  };
}

const allFacts = (h: Awaited<ReturnType<typeof gatherHistory>>) => Object.values(h.items).flat();

describe("gatherHistory", () => {
  test("normal case: annual only, newest first, base units, provenance", async () => {
    const h = await gatherHistory(fakeEdgar(baseData()), "ACME");
    expect(h.latestFiscalYearEnd).toBe("2025-12-31");
    expect(h.latestFilingAccession).toBe(accFor("2025-12-31"));
    expect(h.items.revenue?.map((f) => f.period.end)).toEqual(ENDS);
    expect(h.items.revenue?.map((f) => f.value)).toEqual([300, 250, 200]);
    expect(h.items.ebit?.[0]?.value).toBe(60);
    expect(h.company.name).toBe("Acme Corp");
    expect(h.warnings.some((w) => w.includes("revenue"))).toBe(false);
  });

  test("respects `years`", async () => {
    const h = await gatherHistory(fakeEdgar(baseData()), "ACME", { years: 2 });
    expect(h.items.revenue).toHaveLength(2);
    expect(h.items.cash).toHaveLength(2);
  });

  test("property: every fact validates, has an accession, items newest-first, derived list sources", async () => {
    const data = {
      ...baseData(),
      MarketableSecuritiesCurrent: series("MarketableSecuritiesCurrent", [5, 4, 3], "inst"),
      MarketableSecuritiesNoncurrent: series("MarketableSecuritiesNoncurrent", [50, 40, 30], "inst"),
    };
    const h = await gatherHistory(fakeEdgar(data), "ACME");
    for (const f of allFacts(h)) {
      expect(() => FactSchema.parse(f)).not.toThrow();
      expect(f.evidence.accession).toBeTruthy();
      if (f.derived) expect(f.derivedFrom.length).toBeGreaterThan(0);
    }
    for (const fs of Object.values(h.items)) {
      const ends = (fs ?? []).map((f) => f.period.end);
      expect(ends).toEqual([...ends].sort().reverse());
    }
  });

  test("revenue concept fallback is used and reported", async () => {
    const d = baseData();
    d.Revenues = series("Revenues", [300, 250, 200]);
    d.RevenueFromContractWithCustomerExcludingAssessedTax = undefined as never;
    delete d.RevenueFromContractWithCustomerExcludingAssessedTax;
    const h = await gatherHistory(fakeEdgar(d), "ACME");
    expect(h.items.revenue?.[0]?.concept).toBe("us-gaap:Revenues");
    expect(h.warnings.join("\n")).toMatch(/revenue: used fallback concept Revenues/);
  });

  test("revenue: newest concept wins over a higher-priority concept with only old data", async () => {
    const d = baseData();
    d.Revenues = [dur("Revenues", "2018-12-31", 1)];
    const h = await gatherHistory(fakeEdgar(d), "ACME");
    expect(h.items.revenue?.[0]?.concept).toBe("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax");
  });

  test("revenue missing throws", async () => {
    const d = baseData();
    delete d.RevenueFromContractWithCustomerExcludingAssessedTax;
    await expect(gatherHistory(fakeEdgar(d), "ACME")).rejects.toThrow(/no annual revenue/);
  });

  test("only quarterly revenue throws", async () => {
    const q = dur("Revenues", "2025-12-31", 80, { period_start: "2025-10-01" });
    await expect(gatherHistory(fakeEdgar({ Revenues: [q] }), "ACME")).rejects.toThrow(/no annual revenue/);
  });

  test("D&A missing: item absent with a warning", async () => {
    const d = baseData();
    delete d.DepreciationDepletionAndAmortization;
    const h = await gatherHistory(fakeEdgar(d), "ACME");
    expect(h.items.depreciationAndAmortization).toBeUndefined();
    expect(h.warnings.join("\n")).toMatch(/depreciationAndAmortization: not reported/);
  });

  test("stale concept (no longer reported) is dropped with a warning", async () => {
    const d = baseData();
    d.InterestExpense = [dur("InterestExpense", "2021-12-31", 3)];
    const h = await gatherHistory(fakeEdgar(d), "ACME");
    expect(h.items.interestExpense).toBeUndefined();
    expect(h.warnings.join("\n")).toMatch(/interestExpense: dropped/);
  });

  test("debt: LongTermDebt total is used and commercial paper added", async () => {
    const d = baseData();
    d.CommercialPaper = series("CommercialPaper", [7, 6, 5], "inst");
    d.DebtCurrent = series("DebtCurrent", [999, 999, 999], "inst");
    const h = await gatherHistory(fakeEdgar(d), "ACME");
    const debt = h.items.totalDebt?.[0];
    expect(debt?.value).toBe(107); // 100 + 7; DebtCurrent not added
    expect(debt?.concept).toBe("derived:TotalDebt");
    expect(debt?.derived).toBe(true);
    expect(debt?.evidence.section).toBe("us-gaap:LongTermDebt");
    expect(debt?.derivedFrom).toHaveLength(2);
    expect(h.warnings.join("\n")).toMatch(/DebtCurrent not added/);
  });

  test("debt: assembled from noncurrent + current components", async () => {
    const d = baseData();
    delete d.LongTermDebt;
    d.LongTermDebtNoncurrent = series("LongTermDebtNoncurrent", [90, 100, 110], "inst");
    d.LongTermDebtCurrent = series("LongTermDebtCurrent", [10, 10, 10], "inst");
    const h = await gatherHistory(fakeEdgar(d), "ACME");
    expect(h.items.totalDebt?.map((f) => f.value)).toEqual([100, 110, 120]);
    expect(h.items.totalDebt?.[0]?.evidence.section).toBe("us-gaap:LongTermDebtNoncurrent");
  });

  test("debt: noncurrent + DebtCurrent does not add commercial paper", async () => {
    const d = baseData();
    delete d.LongTermDebt;
    d.LongTermDebtNoncurrent = series("LongTermDebtNoncurrent", [90, 100, 110], "inst");
    d.DebtCurrent = series("DebtCurrent", [15, 15, 15], "inst");
    d.CommercialPaper = series("CommercialPaper", [5, 5, 5], "inst");
    const h = await gatherHistory(fakeEdgar(d), "ACME");
    expect(h.items.totalDebt?.[0]?.value).toBe(105);
  });

  test("no debt concepts: warns, item absent", async () => {
    const d = baseData();
    delete d.LongTermDebt;
    const h = await gatherHistory(fakeEdgar(d), "ACME");
    expect(h.items.totalDebt).toBeUndefined();
    expect(h.warnings.join("\n")).toMatch(/totalDebt: no debt concept/);
  });

  test("marketable securities: current + noncurrent are summed", async () => {
    const d = baseData();
    d.MarketableSecuritiesCurrent = series("MarketableSecuritiesCurrent", [5, 4, 3], "inst");
    d.MarketableSecuritiesNoncurrent = series("MarketableSecuritiesNoncurrent", [50, 40, 30], "inst");
    const h = await gatherHistory(fakeEdgar(d), "ACME");
    expect(h.items.marketableSecurities?.map((f) => f.value)).toEqual([55, 44, 33]);
    const f = h.items.marketableSecurities?.[0];
    expect(f?.concept).toBe("derived:MarketableSecurities");
    expect(f?.evidence.section).toBe("us-gaap:MarketableSecuritiesNoncurrent");
    expect(f?.derivedFrom).toHaveLength(2);
  });

  test("restated value is kept as the service returns it", async () => {
    const d = baseData();
    d.OperatingIncomeLoss = [
      dur("OperatingIncomeLoss", "2025-12-31", 60),
      dur("OperatingIncomeLoss", "2024-12-31", 52, { restated: true, original_value: 50 }),
      dur("OperatingIncomeLoss", "2023-12-31", 40),
    ];
    const h = await gatherHistory(fakeEdgar(d), "ACME");
    expect(h.items.ebit?.[1]?.value).toBe(52);
    expect(h.items.ebit?.[1]?.restated).toBe(true);
  });

  test("instants within +-3 days of a fiscal year end match; farther ones are skipped", async () => {
    const d = baseData();
    d.CashAndCashEquivalentsAtCarryingValue = [
      inst("CashAndCashEquivalentsAtCarryingValue", "2025-12-28", 20), // -3 days: match
      inst("CashAndCashEquivalentsAtCarryingValue", "2024-12-31", 18),
      inst("CashAndCashEquivalentsAtCarryingValue", "2023-06-30", 99), // quarter end: ignore
      inst("CashAndCashEquivalentsAtCarryingValue", "2023-12-27", 15), // -4 days: no match
    ];
    const h = await gatherHistory(fakeEdgar(d), "ACME");
    expect(h.items.cash?.map((f) => f.value)).toEqual([20, 18]);
  });

  test("instants far from every fiscal year end fall back to own dates with a warning", async () => {
    const d = baseData();
    d.AccountsReceivableNetCurrent = [inst("AccountsReceivableNetCurrent", "2025-12-15", 7)];
    const h = await gatherHistory(fakeEdgar(d), "ACME");
    // newest is within 45 days of FYE (reach), but not within 3 days: own dates
    expect(h.items.receivables?.[0]?.value).toBe(7);
    expect(h.warnings.join("\n")).toMatch(/receivables: no balance-sheet date within 3 days/);
  });

  test("looks up each concept at most once and caps concurrency", async () => {
    const edgar = fakeEdgar(baseData());
    let active = 0;
    let peak = 0;
    const orig = edgar.facts.bind(edgar);
    (edgar as unknown as { facts: typeof edgar.facts }).facts = async (t, q) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      try {
        return await orig(t, q);
      } finally {
        active--;
      }
    };
    await gatherHistory(edgar, "ACME");
    expect(new Set(edgar.calls).size).toBe(edgar.calls.length);
    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe("gatherPeerData", () => {
  const market = {
    quote: async () => ({
      price: 10,
      marketCap: 1_000,
      evidence: {
        id: "market:q",
        kind: "market_data" as const,
        accession: null,
        form: null,
        filed: null,
        url: null,
        section: "fmp:quote",
        quote: null,
        span: null,
        retrievedAt: "2026-01-01T00:00:00.000Z",
      },
    }),
  };

  test("ebitda = ebit + D&A; cash includes securities", async () => {
    const d = baseData();
    d.MarketableSecuritiesCurrent = series("MarketableSecuritiesCurrent", [5, 4, 3], "inst");
    const p = await gatherPeerData(fakeEdgar(d), market, "ACME");
    expect(p.revenue).toBe(300);
    expect(p.ebit).toBe(60);
    expect(p.ebitda).toBe(70);
    expect(p.cash).toBe(25);
    expect(p.totalDebt).toBe(100);
    expect(p.fiscalYearEnd).toBe("2025-12-31");
    expect(p.evidence.some((e) => e.kind === "market_data")).toBe(true);
    expect(p.evidence.filter((e) => e.kind === "xbrl_fact").every((e) => e.accession)).toBe(true);
  });

  test("missing D&A: ebitda = ebit with warning", async () => {
    const d = baseData();
    delete d.DepreciationDepletionAndAmortization;
    const p = await gatherPeerData(fakeEdgar(d), market, "ACME");
    expect(p.ebitda).toBe(60);
    expect(p.warnings.join("\n")).toMatch(/EBITDA set equal to EBIT/);
  });

  test("missing EBIT or revenue throws", async () => {
    const d = baseData();
    delete d.OperatingIncomeLoss;
    await expect(gatherPeerData(fakeEdgar(d), market, "ACME")).rejects.toThrow(/EBIT/);
    const e = baseData();
    delete e.RevenueFromContractWithCustomerExcludingAssessedTax;
    await expect(gatherPeerData(fakeEdgar(e), market, "ACME")).rejects.toThrow(/revenue/);
  });
});
