import type { Fact } from "@dealpilot/shared";
import { type EdgarClient, EdgarServiceError, toFact } from "@dealpilot/sources";

export type SharesSource = "cover_page" | "balance_sheet" | "weighted_diluted";

export interface SharesInfo {
  /** Shares outstanding in shares (not millions). */
  shares: number;
  /** Date the count applies to (ISO date). */
  asOf: string;
  source: SharesSource;
  /** The cited fact (accession, form, filing date). */
  fact: Fact;
  warnings: string[];
}

async function latest(
  edgar: EdgarClient,
  ticker: string,
  concept: string,
  now: string,
): Promise<Fact | null> {
  try {
    const res = await edgar.facts(ticker, { concept });
    const facts = res.facts
      .filter((f) => f.unit === "shares" && f.value > 0)
      .map((f) => toFact(res.cik, f, now))
      .sort((a, b) => b.period.end.localeCompare(a.period.end));
    return facts[0] ?? null;
  } catch (e) {
    if (e instanceof EdgarServiceError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Latest reported share count with provenance, in this order:
 *  1. cover page (`dei:EntityCommonStockSharesOutstanding`) from the latest 10-K or 10-Q — the freshest count;
 *  2. balance-sheet count (`us-gaap:CommonStockSharesOutstanding`);
 *  3. the fiscal-year weighted-average diluted count passed in as `fallback` (flagged as less current).
 * Multi-class companies (e.g. Alphabet, Meta) have no company-wide cover-page value in SEC's XBRL company
 * facts, so they usually land on 2 or 3; the warning says so.
 */
export async function gatherShares(
  edgar: EdgarClient,
  ticker: string,
  opts: { fallbackDiluted?: Fact; now?: () => Date } = {},
): Promise<SharesInfo> {
  const now = (opts.now ?? (() => new Date()))().toISOString();

  const cover = await latest(edgar, ticker, "dei:EntityCommonStockSharesOutstanding", now);
  if (cover)
    return { shares: cover.value, asOf: cover.period.end, source: "cover_page", fact: cover, warnings: [] };

  const bs = await latest(edgar, ticker, "us-gaap:CommonStockSharesOutstanding", now);
  if (bs) {
    return {
      shares: bs.value,
      asOf: bs.period.end,
      source: "balance_sheet",
      fact: bs,
      warnings: [
        "No company-wide cover-page share count (possibly multiple share classes); using the balance-sheet count.",
      ],
    };
  }

  if (opts.fallbackDiluted) {
    const f = opts.fallbackDiluted;
    return {
      shares: f.value,
      asOf: f.period.end,
      source: "weighted_diluted",
      fact: f,
      warnings: [
        "No reported share count found (possibly multiple share classes); using the fiscal-year weighted-average diluted count, which can lag buybacks and issuance.",
      ],
    };
  }
  throw new Error(`No share count found for ${ticker}`);
}
