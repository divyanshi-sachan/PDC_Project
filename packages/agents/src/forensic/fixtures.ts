/** Test-only CompanyHistory builder for the forensic rules (not exported from the package index). */
import type { Fact } from "@dealpilot/shared";
import type { CompanyHistory, HistoryItem } from "../research/types.ts";

export const ENDS = ["2026-09-26", "2025-09-27", "2024-09-28", "2023-09-30", "2022-09-24"];

/** A clean, healthy company: values newest first, base USD. */
export const BASE: Record<HistoryItem, number[]> = {
  revenue: [1080, 1000, 930, 870, 810],
  ebit: [216, 200, 186, 174, 162],
  depreciationAndAmortization: [30, 28, 26, 24, 22],
  capex: [30, 28, 26, 24, 22],
  netIncome: [164, 152, 141.6, 132, 123.2],
  pretaxIncome: [205, 190, 177, 165, 154],
  incomeTaxExpense: [41, 38, 35.4, 33, 30.8],
  interestExpense: [10, 10, 10, 10, 10],
  dilutedShares: [100, 100.5, 101, 101.5, 102],
  basicShares: [100, 100.5, 101, 101.5, 102],
  operatingCashFlow: [180, 165, 150, 140, 130],
  cash: [300, 280, 260, 240, 220],
  marketableSecurities: [0, 0, 0, 0, 0],
  totalDebt: [500, 500, 500, 500, 500],
  receivables: [108, 100, 93, 87, 81],
  inventory: [54, 50, 46.5, 43.5, 40.5],
  payables: [90, 85, 80, 75, 70],
  totalAssets: [2000, 1900, 1800, 1700, 1600],
  equity: [800, 760, 720, 680, 640],
};

const INSTANT = new Set<HistoryItem>([
  "cash",
  "marketableSecurities",
  "totalDebt",
  "receivables",
  "inventory",
  "payables",
  "totalAssets",
  "equity",
]);

export function fact(item: HistoryItem, k: number, value: number, restated = false): Fact {
  const end = ENDS[k] as string;
  const instant = INSTANT.has(item);
  return {
    cik: "0001234567",
    concept: `us-gaap:${item}`,
    label: item,
    value,
    unit: item.endsWith("Shares") ? "shares" : "USD",
    scale: 0,
    period: {
      start: instant ? null : "2025-09-28",
      end,
      fiscalYear: Number(end.slice(0, 4)),
      fiscalPeriod: "FY",
    },
    derived: false,
    derivedFrom: [],
    restated,
    evidence: {
      id: `xbrl:${item}:${end}`,
      kind: "xbrl_fact",
      accession: `0001234567-${end.slice(2, 4)}-000001`,
      form: "10-K",
      filed: "2026-11-01",
      url: null,
      section: `us-gaap:${item}`,
      quote: null,
      span: null,
      retrievedAt: "2026-11-21T00:00:00.000Z",
    },
  };
}

export interface BuildOptions {
  /** Replace a whole series (newest first). An empty array removes the item. */
  series?: Partial<Record<HistoryItem, number[]>>;
  /** Mark (item, index) facts as restated. */
  restated?: [HistoryItem, number][];
}

export function buildHistory(o: BuildOptions = {}): CompanyHistory {
  const items: CompanyHistory["items"] = {};
  for (const item of Object.keys(BASE) as HistoryItem[]) {
    const values = o.series?.[item] ?? BASE[item];
    if (values.length === 0) continue;
    items[item] = values.map((v, k) =>
      fact(
        item,
        k,
        v,
        (o.restated ?? []).some(([i, j]) => i === item && j === k),
      ),
    );
  }
  return {
    company: {
      name: "Acme Corp",
      ticker: "ACME",
      cik: "0001234567",
      sic: null,
      sicDescription: null,
      fiscalYearEnd: "0926",
    },
    latestFiscalYearEnd: ENDS[0] as string,
    latestFilingAccession: "0001234567-26-000001",
    items,
    warnings: [],
  };
}
