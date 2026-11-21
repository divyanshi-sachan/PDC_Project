/**
 * Offline test doubles: a synthetic company served by a fake SEC data service, fake market data, and a
 * fake model that behaves like a well-behaved LLM. Test-only (exported as `@dealpilot/agents/testkit`).
 */
import { type FakeCall, fakeLlm } from "@dealpilot/llm";
import type { Evidence } from "@dealpilot/shared";
import { type EdgarClient, EdgarServiceError, type XbrlFact } from "@dealpilot/sources";
import type { MarketApi } from "./modeling/index.ts";

export interface FakeCompany {
  ticker: string;
  name: string;
  cik: string;
  /** Fiscal year end dates, newest first (ISO). */
  fyEnds: string[];
  /** us-gaap concept (no prefix) → values newest first. Missing concepts answer 404 like the real service. */
  series: Record<string, number[]>;
}

const INSTANT = new Set([
  "CashAndCashEquivalentsAtCarryingValue",
  "LongTermDebt",
  "AccountsReceivableNetCurrent",
  "InventoryNet",
  "AccountsPayableCurrent",
  "Assets",
  "StockholdersEquity",
  "MarketableSecuritiesCurrent",
  "ShortTermInvestments",
]);

const dayBefore = (iso: string, days: number) =>
  new Date(Date.parse(iso) - days * 86_400_000).toISOString().slice(0, 10);

function fact(c: FakeCompany, concept: string, k: number, value: number): XbrlFact {
  const end = c.fyEnds[k] as string;
  return {
    concept: `us-gaap:${concept}`,
    label: concept,
    value,
    unit: concept.includes("Shares") ? "shares" : "USD",
    period_start: INSTANT.has(concept) ? null : dayBefore(end, 364),
    period_end: end,
    fiscal_year: Number(end.slice(0, 4)),
    fiscal_period: "FY",
    form: "10-K",
    accession: `0000${c.cik.slice(-6)}-${end.slice(2, 4)}-000001`,
    filed: dayBefore(end, -60),
    frame: null,
    restated: false,
    original_value: null,
  };
}

export function fakeEdgar(companies: FakeCompany[]) {
  const calls = { facts: 0, company: 0 };
  const byTicker = new Map(companies.map((c) => [c.ticker, c]));
  const client = {
    async company(ticker: string) {
      calls.company++;
      const c = byTicker.get(ticker);
      if (!c) throw new EdgarServiceError(404, "not_found", `Unknown ticker ${ticker}`);
      return {
        cik: c.cik,
        ticker: c.ticker,
        name: c.name,
        sic: "3571",
        sic_description: "Electronic Computers",
        fiscal_year_end: "1231",
        exchanges: ["Nasdaq"],
      };
    },
    async facts(ticker: string, q: { concept: string }) {
      calls.facts++;
      const c = byTicker.get(ticker);
      if (!c) throw new EdgarServiceError(404, "not_found", `Unknown ticker ${ticker}`);
      const concept = q.concept.replace(/^us-gaap:/, "");
      const values = c.series[concept];
      if (!values) throw new EdgarServiceError(404, "not_found", `${concept} not reported`);
      return { cik: c.cik, concept: q.concept, facts: values.map((v, k) => fact(c, concept, k, v)) };
    },
    async filings() {
      throw new EdgarServiceError(404, "not_found", "no filings in fake");
    },
    async sections() {
      throw new EdgarServiceError(404, "not_found", "no sections in fake");
    },
    async statements() {
      throw new EdgarServiceError(404, "not_found", "no statements in fake");
    },
    async health() {
      return { status: "ok", edgartools_version: "fake" };
    },
  };
  return { client: client as unknown as EdgarClient, calls };
}

/** Five fiscal years of a profitable, growing company (values newest first, base USD). */
export function company(
  ticker: string,
  o: { scale?: number; growth?: number; margin?: number } = {},
): FakeCompany {
  const s = o.scale ?? 1;
  const g = o.growth ?? 0.1;
  const rev = [0, 1, 2, 3, 4].map((k) => 1_000_000_000 * s * (1 + g) ** -k);
  const m = o.margin ?? 0.25;
  return {
    ticker,
    name: `${ticker} Corp`,
    cik: String(1_000_000 + ticker.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0)).padStart(10, "0"),
    fyEnds: ["2026-12-31", "2025-12-31", "2024-12-31", "2023-12-31", "2022-12-31"],
    series: {
      RevenueFromContractWithCustomerExcludingAssessedTax: rev,
      OperatingIncomeLoss: rev.map((r) => r * m),
      DepreciationDepletionAndAmortization: rev.map((r) => r * 0.03),
      PaymentsToAcquirePropertyPlantAndEquipment: rev.map((r) => r * 0.04),
      NetIncomeLoss: rev.map((r) => r * m * 0.75),
      IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: rev.map(
        (r) => r * m,
      ),
      IncomeTaxExpenseBenefit: rev.map((r) => r * m * 0.25),
      WeightedAverageNumberOfDilutedSharesOutstanding: [
        100e6 * s,
        101e6 * s,
        102e6 * s,
        103e6 * s,
        104e6 * s,
      ],
      CashAndCashEquivalentsAtCarryingValue: [300e6 * s, 280e6 * s, 260e6 * s, 240e6 * s, 220e6 * s],
      LongTermDebt: [200e6 * s, 210e6 * s, 220e6 * s, 230e6 * s, 240e6 * s],
      AccountsReceivableNetCurrent: rev.map((r) => r * 0.1),
      InventoryNet: rev.map((r) => r * 0.05),
      AccountsPayableCurrent: rev.map((r) => r * 0.09),
      Assets: rev.map((r) => r * 1.5),
      StockholdersEquity: rev.map((r) => r * 0.8),
    },
  };
}

const ev = (id: string, section: string): Evidence => ({
  id,
  kind: "market_data",
  accession: null,
  form: null,
  filed: null,
  url: `https://example.test/${section}`,
  section,
  quote: null,
  span: null,
  retrievedAt: "2026-11-21T00:00:00.000Z",
});

export interface FakeMarketOptions {
  /** ticker → { price, marketCap }. Tickers not listed answer like a plan-limited symbol (rejects). */
  quotes: Record<string, { price: number; marketCap: number }>;
  beta?: number | null;
  riskFree?: number;
  peers?: string[];
}

export function fakeMarket(o: FakeMarketOptions): MarketApi & { calls: { quote: number } } {
  const calls = { quote: 0 };
  return {
    calls,
    async quote(symbol) {
      calls.quote++;
      const q = o.quotes[symbol];
      if (!q) throw new Error(`plan-limited symbol ${symbol}`);
      return { ...q, evidence: ev(`market:fmp:quote:${symbol}`, "fmp:quote") };
    },
    async profile(symbol) {
      return {
        companyName: `${symbol} Corp`,
        beta: o.beta === undefined ? 1.2 : o.beta,
        sector: "Technology",
        industry: "Consumer Electronics",
        evidence: ev(`market:fmp:profile:${symbol}`, "fmp:profile"),
      };
    },
    async peers() {
      return { peers: o.peers ?? [], evidence: ev("market:fmp:peers", "fmp:peers") };
    },
    async riskFreeRate() {
      return { tenYear: o.riskFree ?? 0.04, evidence: ev("market:treasury:10y", "treasury:10y") };
    },
  };
}

export interface FakeModelOptions {
  /** What the router should answer for each user message (matched by substring, first hit wins). */
  routes: { match: string; out: Record<string, unknown> }[];
  peers?: string[];
  commentary?: string;
}

/**
 * A fake model that answers each node like a well-behaved LLM: echoes the baseline assumptions it was
 * shown (always valid), picks the configured peers, and writes digit-free commentary.
 */
export function fakeModel(o: FakeModelOptions) {
  const fl = fakeLlm((call: FakeCall) => {
    if (call.node === "orchestrator.route") {
      const hit = o.routes.find((r) => call.user.includes(r.match));
      if (!hit) throw new Error(`no fake route for: ${call.user.slice(-120)}`);
      return { ticker: null, changes: null, question: null, reply: null, ...hit.out };
    }
    if (call.node === "modeling.assumptions") {
      const json = call.user.slice(call.user.lastIndexOf("{"));
      return JSON.parse(json);
    }
    if (call.node === "modeling.peers") {
      return {
        peers: (o.peers ?? []).map((t) => ({ ticker: t, rationale: `${t} sells comparable products.` })),
      };
    }
    if (call.node === "respond.commentary") {
      return {
        commentary:
          o.commentary ??
          "The result is driven mainly by long-run growth and margin assumptions, so check those first.",
      };
    }
    throw new Error(`unexpected node ${call.node}`);
  });
  return fl;
}
