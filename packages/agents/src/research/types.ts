import type { Evidence, Fact } from "@dealpilot/shared";

/** Annual duration items (income statement / cash flow), one Fact per fiscal year, newest first. */
export type DurationItem =
  | "revenue"
  | "ebit"
  | "depreciationAndAmortization"
  | "capex"
  | "netIncome"
  | "pretaxIncome"
  | "incomeTaxExpense"
  | "interestExpense"
  | "dilutedShares"
  | "basicShares";

/** Balance-sheet (instant) items at fiscal year ends, newest first. */
export type InstantItem =
  | "cash"
  | "marketableSecurities"
  | "totalDebt"
  | "receivables"
  | "inventory"
  | "payables"
  | "totalAssets"
  | "equity";

export type HistoryItem = DurationItem | InstantItem;

export interface CompanyProfile {
  name: string;
  ticker: string;
  cik: string;
  sic: string | null;
  sicDescription: string | null;
  fiscalYearEnd: string | null; // "MMDD"
}

/**
 * Everything the modeling agent needs about a company's reported financials, as cited Facts in BASE units.
 * Every Fact carries its filing (accession) as evidence. Nothing here is computed by an LLM.
 */
export interface CompanyHistory {
  company: CompanyProfile;
  /** Newest fiscal year end covered by the core items (ISO date) and the filing it came from. */
  latestFiscalYearEnd: string;
  latestFilingAccession: string;
  /** Per item: facts newest → oldest, at most `years` entries, annual (≈1y) periods only for DurationItems. */
  items: Partial<Record<HistoryItem, Fact[]>>;
  /**
   * Plain-English notes about fallbacks or missing data
   * (e.g. "InterestExpense not reported; cost of debt will use an assumption").
   */
  warnings: string[];
}

/** Peer inputs for trading comps: latest fiscal year, base units, with provenance. */
export interface PeerData {
  ticker: string;
  name: string;
  fiscalYearEnd: string; // ISO date of the financials used
  marketCap: number;
  price: number;
  totalDebt: number;
  cash: number; // cash + marketable securities
  revenue: number;
  ebit: number;
  ebitda: number; // ebit + D&A (computed in code from cited facts)
  netIncome: number;
  evidence: Evidence[];
  warnings: string[];
}
