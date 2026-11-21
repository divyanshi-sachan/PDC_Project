import { cagr, ebitMargin, effectiveTaxRate, growthRate, mean, percentOf } from "@dealpilot/finance";
import type { Fact } from "@dealpilot/shared";
import type { CompanyHistory, HistoryItem } from "../research/types.ts";

export class UnsupportedCompanyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedCompanyError";
  }
}

export interface YearRow {
  /** Fiscal year end (ISO date). */
  end: string;
  revenue: number;
  ebit: number | null;
  ebitMargin: number | null;
  growth: number | null;
  daPct: number | null;
  capexPct: number | null;
  taxRate: number | null;
}

/** Ratios derived (by `@dealpilot/finance`) from a company's cited annual facts. */
export interface HistorySummary {
  ticker: string;
  name: string;
  /** Newest first. */
  rows: YearRow[];
  latestRevenue: number;
  latestFiscalYearEnd: string;
  /** Cash + marketable securities at the latest fiscal year end. */
  cashAndInvestments: number;
  totalDebt: number;
  dilutedShares: number;
  /** (receivables + inventory − payables) / revenue, or null when any component is missing. */
  nwcRatio: number | null;
  /** interest expense / total debt, or null. */
  observedCostOfDebt: number | null;
  notes: string[];
}

const byEnd = (facts: Fact[] | undefined) => new Map((facts ?? []).map((f) => [f.period.end, f]));

/** Instant facts may drift a few days from the revenue year end; find the closest within 5 days. */
function nearest(facts: Fact[] | undefined, end: string): Fact | undefined {
  const t = Date.parse(end);
  let best: Fact | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  for (const f of facts ?? []) {
    const d = Math.abs(Date.parse(f.period.end) - t);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best && bestD <= 5 * 86_400_000 ? best : undefined;
}

export function summarizeHistory(h: CompanyHistory, opts: { dilutedShares?: number } = {}): HistorySummary {
  const items = (k: HistoryItem) => h.items[k];
  const revenue = items("revenue");
  if (!revenue?.length) throw new UnsupportedCompanyError(`No revenue found for ${h.company.ticker}`);
  const notes = [...h.warnings];

  const ebitBy = byEnd(items("ebit"));
  const daBy = byEnd(items("depreciationAndAmortization"));
  const capexBy = byEnd(items("capex"));
  const taxBy = byEnd(items("incomeTaxExpense"));
  const pretaxBy = byEnd(items("pretaxIncome"));

  const rows: YearRow[] = revenue.map((r, k) => {
    const prev = revenue[k + 1];
    const ebit = ebitBy.get(r.period.end)?.value ?? null;
    const da = daBy.get(r.period.end)?.value ?? null;
    const capex = capexBy.get(r.period.end)?.value ?? null;
    const tax = taxBy.get(r.period.end)?.value ?? null;
    const pretax = pretaxBy.get(r.period.end)?.value ?? null;
    return {
      end: r.period.end,
      revenue: r.value,
      ebit,
      ebitMargin: ebit !== null && r.value > 0 ? ebitMargin({ ebit, revenue: r.value }).value : null,
      growth: prev && prev.value > 0 ? growthRate({ previous: prev.value, current: r.value }).value : null,
      daPct: da !== null && r.value > 0 ? percentOf({ part: da, whole: r.value }).value : null,
      capexPct: capex !== null && r.value > 0 ? percentOf({ part: capex, whole: r.value }).value : null,
      taxRate:
        tax !== null && pretax !== null && pretax > 0
          ? effectiveTaxRate({ incomeTax: tax, pretaxIncome: pretax }).value
          : null,
    };
  });

  const latest = revenue[0] as Fact;
  const end = latest.period.end;

  const cash = nearest(items("cash"), end)?.value ?? 0;
  const secs = nearest(items("marketableSecurities"), end)?.value ?? 0;
  if (!items("cash")?.length) notes.push("Cash not found; treated as 0 in the equity bridge.");
  const debtFact = nearest(items("totalDebt"), end);
  if (!debtFact) notes.push("Total debt not found; treated as 0 in the WACC weights and equity bridge.");
  const totalDebt = debtFact?.value ?? 0;

  const shares = items("dilutedShares")?.[0];
  const sharesValue = opts.dilutedShares ?? shares?.value;
  if (sharesValue === undefined || sharesValue <= 0)
    throw new UnsupportedCompanyError(`No diluted share count found for ${h.company.ticker}`);

  const ar = nearest(items("receivables"), end)?.value;
  const inv = nearest(items("inventory"), end)?.value ?? 0;
  const ap = nearest(items("payables"), end)?.value;
  const nwcRatio =
    ar !== undefined && ap !== undefined && latest.value > 0
      ? percentOf({ part: ar + inv - ap, whole: latest.value }).value
      : null;
  if (nwcRatio === null)
    notes.push("Working-capital items incomplete; ΔNWC assumed proportional to 0 unless adjusted.");

  const interest = items("interestExpense")?.[0]?.value;
  const observedCostOfDebt =
    interest !== undefined && totalDebt > 0 ? percentOf({ part: interest, whole: totalDebt }).value : null;

  return {
    ticker: h.company.ticker,
    name: h.company.name,
    rows,
    latestRevenue: latest.value,
    latestFiscalYearEnd: end,
    cashAndInvestments: cash + secs,
    totalDebt,
    dilutedShares: sharesValue,
    nwcRatio,
    observedCostOfDebt,
    notes,
  };
}

/** Average of up to `n` newest non-null values of a row field via finance `mean`, or null if none. */
export function recentMean(rows: YearRow[], pick: (r: YearRow) => number | null, n = 3): number | null {
  const vals = rows
    .slice(0, n)
    .map(pick)
    .filter((v): v is number => v !== null);
  return vals.length ? mean({ values: vals }).value : null;
}

/** Revenue CAGR over up to `years` newest years, or null when fewer than 2 positive points. */
export function recentRevenueCagr(rows: YearRow[], years = 3): number | null {
  const n = Math.min(years, rows.length - 1);
  if (n < 1) return null;
  const first = rows[n]?.revenue;
  const last = rows[0]?.revenue;
  if (!first || !last || first <= 0 || last <= 0) return null;
  return cagr({ first, last, years: n }).value;
}
