import type { Evidence, Fact } from "@dealpilot/shared";
import type { EdgarClient } from "@dealpilot/sources";
import { gatherHistory } from "./history.ts";
import type { PeerData } from "./types.ts";

/** Structural port satisfied by `createMarketClient(...)` from `@dealpilot/market`. */
export interface MarketPort {
  quote(symbol: string): Promise<{
    price: number;
    marketCap: number;
    evidence: Evidence;
    /** Present when market cap was computed as price × SEC shares: the share-count evidence to cite. */
    extra?: { sharesEvidence: Evidence };
  }>;
}

/**
 * Latest-fiscal-year inputs for trading comps. Only data assembly: ebitda = ebit + D&A and cash = cash + securities are
 * additions of cited facts; no ratios or valuation math.
 */
export async function gatherPeerData(
  edgar: EdgarClient,
  market: MarketPort,
  ticker: string,
): Promise<PeerData> {
  const h = await gatherHistory(edgar, ticker, {
    years: 1,
    items: [
      "revenue",
      "ebit",
      "depreciationAndAmortization",
      "netIncome",
      "cash",
      "marketableSecurities",
      "totalDebt",
    ],
  });
  const warnings = [...h.warnings];
  const first = (k: keyof typeof h.items): Fact | undefined => h.items[k]?.[0];

  const revenue = first("revenue");
  const ebit = first("ebit");
  if (!revenue) throw new Error(`peer ${ticker}: revenue not found`);
  if (!ebit) throw new Error(`peer ${ticker}: operating income (EBIT) not found`);
  const da = first("depreciationAndAmortization");
  const netIncome = first("netIncome");
  const cash = first("cash");
  const sec = first("marketableSecurities");
  const debt = first("totalDebt");

  if (!da) warnings.push("D&A not found: EBITDA set equal to EBIT");
  if (!netIncome) warnings.push("netIncome not found: set to 0 (unverified)");
  if (!cash && !sec) warnings.push("cash not found: set to 0 (unverified)");
  if (!debt) warnings.push("totalDebt not found: set to 0 (unverified)");

  const quote = await market.quote(ticker);
  const used = [revenue, ebit, da, netIncome, cash, sec, debt].filter((f): f is Fact => f !== undefined);
  const evidence = dedupeEvidence([
    ...used.map((f) => f.evidence),
    quote.evidence,
    ...(quote.extra ? [quote.extra.sharesEvidence] : []),
  ]);

  return {
    ticker: h.company.ticker,
    name: h.company.name,
    fiscalYearEnd: h.latestFiscalYearEnd,
    marketCap: quote.marketCap,
    price: quote.price,
    totalDebt: debt?.value ?? 0,
    cash: (cash?.value ?? 0) + (sec?.value ?? 0),
    revenue: revenue.value,
    ebit: ebit.value,
    ebitda: ebit.value + (da?.value ?? 0),
    netIncome: netIncome?.value ?? 0,
    evidence,
    warnings,
  };
}

function dedupeEvidence(list: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  return list.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}
