import type { Evidence, Fact } from "@dealpilot/shared";
import createClient from "openapi-fetch";
import type { components, paths } from "./schema.gen.ts";

export type XbrlFact = components["schemas"]["XbrlFact"];
export type Company = components["schemas"]["Company"];
export type Filing = components["schemas"]["Filing"];
export type Statement = components["schemas"]["Statement"];
export type Section = components["schemas"]["Section"];

export class EdgarServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`edgar-service ${status} ${code}: ${message}`);
  }
}

/** Typed client for services/edgar. TS code never calls sec.gov directly. */
export function createEdgarClient(opts: { baseUrl: string; serviceKey?: string; fetch?: typeof fetch }) {
  const api = createClient<paths>({
    baseUrl: opts.baseUrl,
    headers: opts.serviceKey ? { "X-Service-Key": opts.serviceKey } : {},
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });

  function unwrap<T>(r: { data?: T; error?: unknown; response: Response }): T {
    if (r.data !== undefined && r.response.ok) return r.data;
    const e = (r.error ?? {}) as { error?: { code?: string; message?: string } };
    throw new EdgarServiceError(
      r.response.status,
      e.error?.code ?? "unknown",
      e.error?.message ?? r.response.statusText,
    );
  }

  return {
    health: async () => unwrap(await api.GET("/health")),
    company: async (ticker: string) =>
      unwrap(await api.GET("/companies/{ticker}", { params: { path: { ticker } } })),
    filings: async (ticker: string, q: { form?: string; limit?: number } = {}) =>
      unwrap(await api.GET("/companies/{ticker}/filings", { params: { path: { ticker }, query: q } })),
    facts: async (ticker: string, q: { concept: string; form?: string; all_versions?: boolean }) =>
      unwrap(await api.GET("/companies/{ticker}/facts", { params: { path: { ticker }, query: q } })),
    statements: async (
      ticker: string,
      q: { kind: "income" | "balance" | "cashflow"; period?: "annual" | "quarterly"; limit?: number },
    ) => unwrap(await api.GET("/companies/{ticker}/statements", { params: { path: { ticker }, query: q } })),
    sections: async (accession: string, items?: string) =>
      unwrap(
        await api.GET("/filings/{accession}/sections", {
          params: { path: { accession }, query: items ? { items } : {} },
        }),
      ),
  };
}
export type EdgarClient = ReturnType<typeof createEdgarClient>;

const FISCAL_PERIODS = new Set(["FY", "Q1", "Q2", "Q3", "Q4"]);

const archiveUrl = (cik: string, accession: string) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-", "")}/`;

/**
 * Map an edgar-service XBRL fact to the shared `Fact` (with xbrl_fact evidence).
 * Values are passed through untouched — no unit or sign post-processing.
 */
export function toFact(cik: string, f: XbrlFact, retrievedAt: string): Fact {
  const evidence: Evidence = {
    id: `xbrl:${f.accession}:${f.concept}:${f.period_start ?? ""}:${f.period_end}:${f.unit}`,
    kind: "xbrl_fact",
    accession: f.accession,
    form: f.form,
    filed: f.filed,
    url: archiveUrl(cik, f.accession),
    section: f.concept,
    quote: null,
    span: null,
    retrievedAt,
  };
  const fp = f.fiscal_period && FISCAL_PERIODS.has(f.fiscal_period) ? f.fiscal_period : null;
  return {
    cik,
    concept: f.concept,
    label: f.label ?? f.concept,
    value: f.value,
    unit: f.unit,
    scale: 0,
    period: {
      start: f.period_start,
      end: f.period_end,
      fiscalYear: f.fiscal_year,
      fiscalPeriod: fp as Fact["period"]["fiscalPeriod"],
    },
    derived: false,
    derivedFrom: [],
    restated: f.restated,
    evidence,
  };
}
