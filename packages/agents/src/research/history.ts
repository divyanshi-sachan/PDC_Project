import type { Fact } from "@dealpilot/shared";
import { type EdgarClient, EdgarServiceError, toFact, type XbrlFact } from "@dealpilot/sources";
import {
  DEBT_CONCEPTS,
  DURATION_ITEMS,
  expectedUnit,
  INSTANT_ITEMS,
  MARKETABLE_SECURITIES_TIERS,
  SIMPLE_CONCEPTS,
} from "./concepts.ts";
import type { CompanyHistory, DurationItem, HistoryItem, InstantItem } from "./types.ts";

const DAY_MS = 86_400_000;
const MAX_CONCURRENCY = 4;
/** A concept "reaches" the latest fiscal year if its newest period ends within this many days of it. */
const REACH_DAYS = 45;
/** Instant facts match a fiscal year end (from the revenue series) within this many days. */
const FYE_TOLERANCE_DAYS = 3;

const dayNum = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
const daysBetween = (a: string, b: string): number => dayNum(b) - dayNum(a);

function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            queue.shift()?.();
          });
      };
      if (active < max) run();
      else queue.push(run);
    });
}

/** One fact per period_end, keeping the most recently filed (the service already dedupes; this is defensive). */
function dedupeByEnd(facts: XbrlFact[]): XbrlFact[] {
  const byEnd = new Map<string, XbrlFact>();
  for (const f of facts) {
    const cur = byEnd.get(f.period_end);
    if (!cur || f.filed > cur.filed) byEnd.set(f.period_end, f);
  }
  return [...byEnd.values()].sort((a, b) => (a.period_end < b.period_end ? 1 : -1));
}

const isAnnual = (f: XbrlFact): boolean => {
  if (f.period_start === null) return false;
  const d = daysBetween(f.period_start, f.period_end);
  return d >= 350 && d <= 380;
};

interface Loaded {
  concept: string;
  facts: XbrlFact[]; // cleaned, newest first
}

interface Resolved {
  tierIndex: number;
  comps: Loaded[];
  newest: string;
  stale: boolean;
}

export interface GatherHistoryOptions {
  years?: number;
  items?: HistoryItem[];
  /** Injectable clock for `retrievedAt` (tests). */
  now?: () => Date;
}

/**
 * Gather a company's annual reported financials as cited Facts (base units, newest first).
 *
 * Only data assembly happens here. The single arithmetic operation is SUMMING reported debt / marketable-securities
 * components into `derived: true` facts (see `assembleTotalDebt`).
 */
export async function gatherHistory(
  edgar: EdgarClient,
  ticker: string,
  opts: GatherHistoryOptions = {},
): Promise<CompanyHistory> {
  const years = opts.years ?? 5;
  const wanted = new Set<HistoryItem>(opts.items ?? [...DURATION_ITEMS, ...INSTANT_ITEMS]);
  wanted.add("revenue");
  const now = opts.now ?? (() => new Date());
  const retrievedAt = now().toISOString();
  const warnings: string[] = [];
  const limit = createLimiter(MAX_CONCURRENCY);

  const profile = await edgar.company(ticker);
  const cik = profile.cik;

  // Raw 10-K facts per concept, de-duplicated across items. `null` = concept not reported (404).
  const rawCache = new Map<string, Promise<XbrlFact[] | null>>();
  const raw = (concept: string): Promise<XbrlFact[] | null> => {
    let p = rawCache.get(concept);
    if (!p) {
      p = limit(async () => {
        try {
          return (await edgar.facts(ticker, { concept, form: "10-K" })).facts;
        } catch (e) {
          if (e instanceof EdgarServiceError && e.status === 404) return null;
          throw e;
        }
      });
      rawCache.set(concept, p);
    }
    return p;
  };

  const load = async (concept: string, item: HistoryItem, kind: "duration" | "instant"): Promise<Loaded> => {
    const unit = expectedUnit(item as DurationItem | InstantItem);
    const facts = ((await raw(concept)) ?? []).filter(
      (f) => f.unit === unit && (kind === "duration" ? isAnnual(f) : f.period_start === null),
    );
    return { concept, facts: dedupeByEnd(facts) };
  };

  /**
   * Pick the first tier (list of concepts) whose newest data reaches `ref`. With no `ref`, the tier with the newest
   * data wins (ties go to the earlier tier). If none reaches, the tier with the newest data is returned as stale.
   */
  const resolve = async (
    item: HistoryItem,
    tiers: readonly (readonly string[])[],
    kind: "duration" | "instant",
    ref: string | null,
  ): Promise<Resolved | null> => {
    let best: Resolved | null = null;
    for (let i = 0; i < tiers.length; i++) {
      const comps = await Promise.all((tiers[i] ?? []).map((c) => load(c, item, kind)));
      const newest = comps.reduce(
        (m, c) => (c.facts[0] && c.facts[0].period_end > m ? c.facts[0].period_end : m),
        "",
      );
      if (!newest) continue;
      if (ref !== null && daysBetween(newest, ref) <= REACH_DAYS) {
        return { tierIndex: i, comps, newest, stale: false };
      }
      if (!best || newest > best.newest) best = { tierIndex: i, comps, newest, stale: ref !== null };
    }
    return best;
  };

  const noteFallback = (item: string, tiers: readonly (readonly string[])[], r: Resolved): void => {
    if (r.tierIndex > 0) {
      warnings.push(
        `${item}: used fallback concept ${r.comps.map((c) => c.concept).join(" + ")} (not reported: ${(tiers[0] ?? []).join(" + ")} or newer fallbacks)`,
      );
    }
  };

  // ---- Revenue defines the fiscal years ----
  const revTiers = SIMPLE_CONCEPTS.revenue.map((c) => [c]);
  const revRes = await resolve("revenue", revTiers, "duration", null);
  const revAll = revRes?.comps[0]?.facts ?? [];
  const revFacts = revAll.slice(0, years);
  const newestRev = revFacts[0];
  if (!revRes || !newestRev) {
    throw new Error(
      `gatherHistory(${ticker}): no annual revenue found under any of ${SIMPLE_CONCEPTS.revenue.join(", ")}`,
    );
  }
  noteFallback("revenue", revTiers, revRes);
  const latestFiscalYearEnd = newestRev.period_end;
  const fyEnds = revFacts.map((f) => f.period_end);

  const items: Partial<Record<HistoryItem, Fact[]>> = {};
  items.revenue = revFacts.map((f) => toFact(cik, f, retrievedAt));

  // ---- Other duration items ----
  const durationTodo = DURATION_ITEMS.filter((i) => i !== "revenue" && wanted.has(i));
  await Promise.all(
    durationTodo.map(async (item) => {
      const tiers = SIMPLE_CONCEPTS[item as keyof typeof SIMPLE_CONCEPTS].map((c) => [c]);
      const r = await resolve(item, tiers, "duration", latestFiscalYearEnd);
      const comp = r?.comps[0];
      if (!r || !comp) {
        warnings.push(`${item}: not reported under ${tiers.flat().join(", ")}`);
        return;
      }
      noteFallback(item, tiers, r);
      if (r.stale) {
        warnings.push(
          `${item}: dropped; newest ${comp.concept} period ends ${r.newest}, before ${latestFiscalYearEnd} (no longer reported)`,
        );
        return;
      }
      items[item] = comp.facts.slice(0, years).map((f) => toFact(cik, f, retrievedAt));
    }),
  );

  // ---- Instant helpers ----
  const lookup = (facts: XbrlFact[], date: string): XbrlFact | undefined => {
    let best: XbrlFact | undefined;
    let bestD = Number.POSITIVE_INFINITY;
    for (const f of facts) {
      const d = Math.abs(daysBetween(date, f.period_end));
      if (d <= FYE_TOLERANCE_DAYS && d < bestD) {
        best = f;
        bestD = d;
      }
    }
    return best;
  };

  /** Target dates: revenue fiscal year ends, or (when nothing matches) the item's own newest period ends. */
  const targetDates = (item: string, all: XbrlFact[][]): string[] => {
    const hit = fyEnds.some((d) => all.some((fs) => lookup(fs, d)));
    if (hit) return fyEnds;
    const own = [...new Set(all.flatMap((fs) => fs.map((f) => f.period_end)))]
      .sort()
      .reverse()
      .slice(0, years);
    if (own.length > 0)
      warnings.push(
        `${item}: no balance-sheet date within ${FYE_TOLERANCE_DAYS} days of a revenue fiscal year end; using its own dates`,
      );
    return own;
  };

  // ---- Simple instant items ----
  const instantSimple = INSTANT_ITEMS.filter(
    (i) => i !== "totalDebt" && i !== "marketableSecurities" && wanted.has(i),
  );
  await Promise.all(
    instantSimple.map(async (item) => {
      const tiers = SIMPLE_CONCEPTS[item as keyof typeof SIMPLE_CONCEPTS].map((c) => [c]);
      const r = await resolve(item, tiers, "instant", latestFiscalYearEnd);
      const comp = r?.comps[0];
      if (!r || !comp) {
        warnings.push(`${item}: not reported under ${tiers.flat().join(", ")}`);
        return;
      }
      noteFallback(item, tiers, r);
      if (r.stale) {
        warnings.push(
          `${item}: dropped; newest ${comp.concept} date is ${r.newest}, before ${latestFiscalYearEnd} (no longer reported)`,
        );
        return;
      }
      const out: Fact[] = [];
      for (const d of targetDates(item, [comp.facts])) {
        const f = lookup(comp.facts, d);
        if (f) out.push(toFact(cik, f, retrievedAt));
      }
      items[item] = out;
    }),
  );

  // ---- Marketable securities (sum of components) ----
  if (wanted.has("marketableSecurities")) {
    const r = await resolve(
      "marketableSecurities",
      MARKETABLE_SECURITIES_TIERS,
      "instant",
      latestFiscalYearEnd,
    );
    if (!r) {
      warnings.push(
        `marketableSecurities: not reported under ${MARKETABLE_SECURITIES_TIERS.flat().join(", ")}`,
      );
    } else {
      noteFallback("marketableSecurities", MARKETABLE_SECURITIES_TIERS, r);
      const out: Fact[] = [];
      for (const d of targetDates(
        "marketableSecurities",
        r.comps.map((c) => c.facts),
      )) {
        const parts = r.comps.flatMap((c) => {
          const f = lookup(c.facts, d);
          return f ? [toFact(cik, f, retrievedAt)] : [];
        });
        if (parts.length > 0) {
          out.push(
            sumFacts(
              cik,
              "derived:MarketableSecurities",
              "Marketable securities (current + noncurrent)",
              parts,
            ),
          );
        }
      }
      if (r.stale) {
        warnings.push(
          `marketableSecurities: dropped; newest date is ${r.newest}, before ${latestFiscalYearEnd} (no longer reported)`,
        );
      } else {
        items.marketableSecurities = out;
      }
    }
  }

  // ---- Total debt (sum of components) ----
  if (wanted.has("totalDebt")) {
    const names = Object.values(DEBT_CONCEPTS);
    const loaded = await Promise.all(names.map((c) => load(c, "totalDebt", "instant")));
    const byName = Object.fromEntries(loaded.map((l) => [l.concept, l.facts])) as Record<string, XbrlFact[]>;
    const all = loaded.map((l) => l.facts);
    if (all.every((fs) => fs.length === 0)) {
      warnings.push(
        `totalDebt: no debt concept reported (${names.join(", ")}); treat as zero only after checking the filing`,
      );
    } else {
      const out: Fact[] = [];
      const policies = new Set<string>();
      for (const d of targetDates("totalDebt", all)) {
        const res = assembleTotalDebt(cik, d, byName, lookup, retrievedAt);
        if (res) {
          out.push(res.fact);
          policies.add(res.policy);
        }
      }
      for (const p of policies) warnings.push(`totalDebt: ${p}`);
      if (out.length > 0) {
        warnings.push(
          "totalDebt: excludes operating and finance lease liabilities unless included in the reported debt concepts",
        );
      }
      items.totalDebt = out;
    }
  }

  const latestFilingAccession = newestRev.accession;
  return {
    company: {
      name: profile.name,
      ticker: profile.ticker,
      cik,
      sic: profile.sic,
      sicDescription: profile.sic_description,
      fiscalYearEnd: profile.fiscal_year_end,
    },
    latestFiscalYearEnd,
    latestFilingAccession,
    items: pruneToWanted(items, wanted),
    warnings,
  };
}

function pruneToWanted(
  items: Partial<Record<HistoryItem, Fact[]>>,
  wanted: Set<HistoryItem>,
): Partial<Record<HistoryItem, Fact[]>> {
  const out: Partial<Record<HistoryItem, Fact[]>> = {};
  for (const [k, v] of Object.entries(items) as [HistoryItem, Fact[]][]) {
    if (wanted.has(k)) out[k] = v;
  }
  return out;
}

/**
 * Sum reported component facts into one derived Fact. Evidence is the LARGEST component's evidence so the number
 * still cites a real filing; `derivedFrom` lists every component's evidence id (which embeds its concept).
 */
export function sumFacts(cik: string, concept: string, label: string, parts: Fact[]): Fact {
  const largest = parts.reduce((m, p) => (Math.abs(p.value) > Math.abs(m.value) ? p : m));
  return {
    cik,
    concept,
    label,
    value: parts.reduce((s, p) => s + p.value, 0),
    unit: largest.unit,
    scale: 0,
    period: largest.period,
    derived: true,
    derivedFrom: parts.map((p) => p.evidence.id),
    restated: parts.some((p) => p.restated),
    evidence: largest.evidence,
  };
}

/**
 * Total debt at one balance-sheet date, from reported components, avoiding double counting:
 *  - LongTermDebt (total incl. current portion) present: base = LongTermDebt, plus CommercialPaper and
 *    ShortTermBorrowings (not part of LongTermDebt). DebtCurrent is NOT added (it overlaps LongTermDebt).
 *  - Else base = LongTermDebtNoncurrent + LongTermDebtCurrent, plus CommercialPaper and ShortTermBorrowings.
 *  - Else (no LongTermDebtCurrent) base = LongTermDebtNoncurrent + DebtCurrent; DebtCurrent is assumed to already
 *    contain commercial paper / short-term borrowings, so those are NOT added.
 *  - Else DebtCurrent alone.
 */
function assembleTotalDebt(
  cik: string,
  date: string,
  by: Record<string, XbrlFact[]>,
  lookup: (facts: XbrlFact[], date: string) => XbrlFact | undefined,
  retrievedAt: string,
): { fact: Fact; policy: string } | null {
  const get = (c: string): XbrlFact | undefined => lookup(by[c] ?? [], date);
  const total = get(DEBT_CONCEPTS.total);
  const nc = get(DEBT_CONCEPTS.noncurrent);
  const cur = get(DEBT_CONCEPTS.currentLtd);
  const dc = get(DEBT_CONCEPTS.debtCurrent);
  const cp = get(DEBT_CONCEPTS.commercialPaper);
  const stb = get(DEBT_CONCEPTS.shortTermBorrowings);

  let parts: (XbrlFact | undefined)[];
  let policy: string;
  if (total) {
    parts = [total, cp, stb];
    policy = `LongTermDebt (total) + CommercialPaper + ShortTermBorrowings where reported; DebtCurrent not added (overlaps LongTermDebt)`;
  } else if (nc && cur) {
    parts = [nc, cur, cp, stb];
    policy = `LongTermDebtNoncurrent + LongTermDebtCurrent + CommercialPaper + ShortTermBorrowings where reported`;
  } else if (nc && dc) {
    parts = [nc, dc];
    policy = `LongTermDebtNoncurrent + DebtCurrent (DebtCurrent assumed to include short-term borrowings and commercial paper)`;
  } else if (nc) {
    parts = [nc, cp, stb];
    policy = `LongTermDebtNoncurrent + CommercialPaper + ShortTermBorrowings where reported (no current portion of long-term debt reported)`;
  } else if (dc) {
    parts = [dc];
    policy = "DebtCurrent only (no long-term debt reported)";
  } else {
    parts = [cp, stb];
    policy = "CommercialPaper + ShortTermBorrowings only (no long-term debt reported)";
  }
  const facts = parts.filter((p): p is XbrlFact => p !== undefined).map((p) => toFact(cik, p, retrievedAt));
  if (facts.length === 0) return null;
  return {
    fact: sumFacts(cik, "derived:TotalDebt", "Total debt (sum of reported components)", facts),
    policy,
  };
}
