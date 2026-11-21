/**
 * Citation resolution. The Verifier does not trust the evidence objects it is given: it re-fetches the cited facts
 * from the SEC data service and checks that the accession, period, unit and (for revenue) the value really exist.
 */
import type { Defect, Evidence, Panel } from "@dealpilot/shared";
import { type EdgarClient, EdgarServiceError } from "@dealpilot/sources";
import { close, defect } from "./recompute.ts";

const DAY = 86_400_000;

/** `xbrl:<accession>:<concept>:<start|empty>:<end>:<unit>` (see `toFact` in @dealpilot/sources). */
const XBRL_ID = /^xbrl:([\d-]+):([^:]+:[^:]+):(\d{4}-\d{2}-\d{2})?:(\d{4}-\d{2}-\d{2}):(.+)$/;

export interface ParsedXbrlEvidence {
  accession: string;
  concept: string;
  start: string | null;
  end: string;
  unit: string;
}

export function parseXbrlEvidence(e: Evidence): ParsedXbrlEvidence | null {
  const m = XBRL_ID.exec(e.id);
  if (!m) return null;
  return {
    accession: m[1] as string,
    concept: m[2] as string,
    start: m[3] ?? null,
    end: m[4] as string,
    unit: m[5] as string,
  };
}

/** What each filing-sourced assumption must look like. */
const EXPECT: Record<string, "annual" | "instant" | "either"> = {
  revenue_base: "annual",
  tax_rate: "annual",
  da_pct: "annual",
  capex_pct: "annual",
  ebit_margin_y1: "annual",
  total_debt: "instant",
  cash: "instant",
  diluted_shares: "either",
};

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;

export async function resolveCitations(
  edgar: EdgarClient | undefined,
  panel: Panel,
): Promise<{ defects: Defect[]; items: number; skipped: string | null }> {
  const defects: Defect[] = [];
  let items = 0;
  const asOf = Date.parse(panel.asOf);

  // 1) Every cited figure has evidence that exists and is complete.
  for (const a of panel.assumptions) {
    if (a.source === "assumption" || a.key === "market_cap") continue;
    items++;
    const ev = a.evidenceId ? panel.evidence[a.evidenceId] : undefined;
    if (!ev) {
      defects.push(
        defect({
          type: "citation_missing",
          severity: "error",
          ownerNode: "research",
          subject: `assumption:${a.key}`,
          detail: `"${a.label}" is presented as coming from a ${a.source === "filing" ? "filing" : "market data source"} but has no resolvable citation.`,
          expected: "evidence",
          actual: a.evidenceId ?? "none",
        }),
      );
      continue;
    }
    if (ev.kind === "market_data") {
      if (!ev.url || !ev.retrievedAt) {
        defects.push(
          defect({
            type: "citation_missing",
            severity: "error",
            ownerNode: "research",
            subject: `assumption:${a.key}`,
            detail: `The market-data citation for "${a.label}" lacks a source URL or retrieval time.`,
          }),
        );
      } else if (a.key === "price" && asOf - Date.parse(ev.retrievedAt) > 7 * DAY) {
        defects.push(
          defect({
            type: "period_mismatch",
            severity: "warning",
            ownerNode: "research",
            subject: "assumption:price",
            detail: "The share price was retrieved more than 7 days before the analysis date.",
          }),
        );
      }
    } else if (ev.kind === "xbrl_fact" && (!ev.accession || !ev.form || !ev.filed)) {
      defects.push(
        defect({
          type: "citation_missing",
          severity: "error",
          ownerNode: "research",
          subject: `assumption:${a.key}`,
          detail: `The filing citation for "${a.label}" lacks an accession number, form or filing date.`,
        }),
      );
    }
  }

  // 2) Period / unit sanity for each filing-sourced assumption (from the evidence id).
  for (const a of panel.assumptions) {
    const want = EXPECT[a.key];
    const ev = a.evidenceId ? panel.evidence[a.evidenceId] : undefined;
    if (!want || !ev || ev.kind !== "xbrl_fact") continue;
    const p = parseXbrlEvidence(ev);
    if (!p) continue;
    items++;
    const length = p.start ? days(p.start, p.end) : null;
    const annual = length !== null && length >= 350 && length <= 380;
    const instant = p.start === null;
    if ((want === "annual" && !annual) || (want === "instant" && !instant)) {
      defects.push(
        defect({
          type: "period_mismatch",
          severity: "error",
          ownerNode: "research",
          subject: `assumption:${a.key}`,
          detail: `"${a.label}" needs a${want === "annual" ? "n annual (about 365-day) period" : "n instant (balance-sheet date)"} fact but cites ${instant ? "an instant" : `a ${Math.round(length ?? 0)}-day`} fact (${p.start ?? ""}${p.start ? " to " : ""}${p.end}).`,
          expected: want,
          actual: instant ? "instant" : `${Math.round(length ?? 0)} days`,
        }),
      );
    }
    if (days(p.end, panel.asOf.slice(0, 10)) > 500) {
      defects.push(
        defect({
          type: "period_mismatch",
          severity: "warning",
          ownerNode: "research",
          subject: `assumption:${a.key}`,
          detail: `The cited fact ends ${p.end}, more than 500 days before the analysis date.`,
        }),
      );
    }
  }

  // 3) Re-fetch the target company's cited facts from SEC data and confirm they exist (and revenue matches).
  if (!edgar)
    return { defects, items, skipped: "no SEC data client: citations were checked for completeness only" };
  const own = Object.values(panel.evidence).filter(
    (e) => e.kind === "xbrl_fact" && e.accession?.slice(0, 10) === panel.cik,
  );
  const byConcept = new Map<string, Evidence[]>();
  for (const e of own) {
    const p = parseXbrlEvidence(e);
    if (p) byConcept.set(p.concept, [...(byConcept.get(p.concept) ?? []), e]);
  }
  for (const [concept, evs] of byConcept) {
    let facts: Awaited<ReturnType<EdgarClient["facts"]>>["facts"];
    try {
      facts = (await edgar.facts(panel.ticker, { concept, all_versions: true })).facts;
    } catch (e) {
      if (e instanceof EdgarServiceError && e.status === 404) {
        for (const ev of evs) {
          items++;
          defects.push(
            defect({
              type: "citation_mismatch",
              severity: "error",
              ownerNode: "research",
              subject: `evidence:${ev.id}`,
              detail: `SEC data has no concept ${concept} for ${panel.ticker}, but the deliverable cites it.`,
            }),
          );
        }
        continue;
      }
      throw e;
    }
    for (const ev of evs) {
      items++;
      const p = parseXbrlEvidence(ev) as ParsedXbrlEvidence;
      const hit = facts.find(
        (f) =>
          f.accession === p.accession &&
          f.period_end === p.end &&
          (f.period_start ?? null) === p.start &&
          f.unit === p.unit,
      );
      if (!hit) {
        defects.push(
          defect({
            type: "citation_mismatch",
            severity: "error",
            ownerNode: "research",
            subject: `evidence:${ev.id}`,
            detail: `Filing ${p.accession} does not report ${concept} for the period ${p.start ?? ""}${p.start ? " to " : ""}${p.end} (${p.unit}) in SEC data.`,
            expected: "fact present",
            actual: "not found",
          }),
        );
        continue;
      }
      // The cited value must match what is stated, where the assumption IS the fact (revenue).
      const revenue = panel.assumptions.find((x) => x.key === "revenue_base" && x.evidenceId === ev.id);
      if (revenue && !close(hit.value, revenue.value, 1e-9)) {
        defects.push(
          defect({
            type: "citation_mismatch",
            severity: "error",
            ownerNode: "research",
            subject: "assumption:revenue_base",
            detail: `Base-year revenue is stated as ${revenue.value} but filing ${p.accession} reports ${hit.value}.`,
            expected: hit.value,
            actual: revenue.value,
          }),
        );
      }
    }
  }
  return { defects, items, skipped: null };
}

/**
 * Evidence answers (filing quotes): re-fetch the section and confirm each quote sits at its span.
 * Used for "what does the 10-K say about X" answers.
 */
export async function verifyFilingQuotes(
  edgar: EdgarClient,
  evidence: Evidence[],
): Promise<{ defects: Defect[]; items: number }> {
  const defects: Defect[] = [];
  let items = 0;
  for (const ev of evidence) {
    if (ev.kind !== "filing_text" || !ev.accession || !ev.quote) continue;
    items++;
    const item = (ev.section ?? "").replace(/^Item\s+/i, "");
    try {
      const sections = await edgar.sections(ev.accession, item);
      const text =
        sections.find((s) => s.item.toUpperCase() === item.toUpperCase())?.text ?? sections[0]?.text ?? "";
      const atSpan = ev.span ? text.slice(ev.span[0], ev.span[1]) === ev.quote : false;
      if (!atSpan && !text.includes(ev.quote)) {
        defects.push(
          defect({
            type: "citation_unsupported",
            severity: "error",
            ownerNode: "research",
            subject: `evidence:${ev.id}`,
            detail: `The quoted passage is not in ${ev.form ?? "the filing"} ${ev.accession} ${ev.section ?? ""}.`,
            expected: ev.quote.slice(0, 80),
            actual: "not found",
          }),
        );
      }
    } catch {
      defects.push(
        defect({
          type: "citation_unsupported",
          severity: "warning",
          ownerNode: "research",
          subject: `evidence:${ev.id}`,
          detail: "The cited filing section could not be re-fetched to confirm the quote.",
        }),
      );
    }
  }
  return { defects, items };
}
