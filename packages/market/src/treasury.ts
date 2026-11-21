import { MarketDataError } from "./errors.ts";
import { type FetchLike, marketEvidence, type RiskFreeRate } from "./types.ts";

export function treasuryUrl(year: number): string {
  return `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/**
 * Latest row with a populated "10 Yr" column. Percent in the CSV (4.92) becomes a
 * decimal (0.0492). Row order is not assumed. Returns null when no row qualifies.
 */
export function parseTreasuryCsv(csv: string): { date: string; tenYear: number } | null {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines[0] ? splitCsvLine(lines[0]) : [];
  const dateIdx = header.indexOf("Date");
  const tenIdx = header.indexOf("10 Yr");
  if (dateIdx < 0 || tenIdx < 0) {
    throw new MarketDataError("invalid_response", "Treasury CSV is missing the Date or 10 Yr column");
  }
  let best: { date: string; tenYear: number } | null = null;
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(cells[dateIdx] ?? "");
    const raw = cells[tenIdx] ?? "";
    if (!m || raw === "") continue;
    const pct = Number(raw);
    if (!Number.isFinite(pct)) continue;
    const date = `${m[3]}-${m[1]}-${m[2]}`;
    if (!best || date > best.date) best = { date, tenYear: pct / 100 };
  }
  return best;
}

export async function fetchTenYearYield(
  opts: { fetch?: FetchLike; now?: () => Date } = {},
): Promise<RiskFreeRate> {
  const doFetch: FetchLike = opts.fetch ?? ((u, i) => fetch(u, i));
  const now = (opts.now ?? (() => new Date()))();
  const year = now.getUTCFullYear();

  // Early January may have no rows yet; fall back to the prior year's file.
  for (const y of [year, year - 1]) {
    const url = treasuryUrl(y);
    let res: Response;
    let text: string;
    try {
      res = await doFetch(url);
      text = await res.text();
    } catch {
      throw new MarketDataError("upstream_error", "Treasury: network failure");
    }
    if (res.status === 429) throw new MarketDataError("rate_limited", "Treasury rate limited", 429);
    if (res.status !== 200)
      throw new MarketDataError("upstream_error", `Treasury HTTP ${res.status}`, res.status);
    const row = parseTreasuryCsv(text);
    if (!row) continue;
    const retrievedAt = now.toISOString();
    return {
      date: row.date,
      tenYear: row.tenYear,
      sourceUrl: url,
      evidence: marketEvidence({
        id: `market:treasury:10y:${row.date}`,
        url,
        section: "treasury:10y",
        retrievedAt,
      }),
    };
  }
  throw new MarketDataError("not_found", "Treasury: no 10 Yr yield rows found");
}
