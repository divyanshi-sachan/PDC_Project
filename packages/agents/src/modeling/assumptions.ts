import { linearFade } from "@dealpilot/finance";
import type { LlmClient } from "@dealpilot/llm";
import { z } from "zod";
import { loadPrompt } from "../prompts.ts";
import { type HistorySummary, recentMean, recentRevenueCagr, UnsupportedCompanyError } from "./summary.ts";

/**
 * Forecast length. Years 1–EXPLICIT_YEARS are where the model may adjust growth and margins; the remaining years
 * are faded by code toward the terminal growth rate, so a high-growth company is not forced to drop to terminal
 * growth after only five years (which systematically undervalues it).
 */
export const EXPLICIT_YEARS = 5;
export const HORIZON_YEARS = 10;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export interface AssumptionSet {
  /** Revenue growth for each projected year (length = HORIZON_YEARS). */
  revenueGrowth: number[];
  /** EBIT margin for each projected year. */
  ebitMargin: number[];
  taxRate: number;
  daPctRevenue: number;
  capexPctRevenue: number;
  /** Net working capital as a fraction of the CHANGE in revenue. */
  nwcPctOfRevenueChange: number;
  terminalGrowth: number;
  equityRiskPremium: number;
  preTaxCostOfDebt: number;
  rationale: { growth: string; margins: string; other: string };
}

/**
 * Deterministic starting point built from the filings with `@dealpilot/finance`:
 * growth fades from the recent revenue CAGR to the terminal rate, margins/tax/D&A/capex use recent averages.
 */
export function baselineAssumptions(s: HistorySummary, riskFreeRate: number): AssumptionSet {
  const margin = recentMean(s.rows, (r) => r.ebitMargin);
  if (margin === null) throw new UnsupportedCompanyError(`Operating income is not reported for ${s.ticker}`);
  if (margin <= 0) {
    throw new UnsupportedCompanyError(
      `${s.ticker} has a negative average operating margin; a DCF is not meaningful without a turnaround thesis.`,
    );
  }
  const g0 = clamp(recentRevenueCagr(s.rows) ?? 0.05, -0.05, 0.25);
  // Terminal growth: 2.5%, capped by the risk-free rate and by the company's own recent growth (a shrinking or
  // flat business is not assumed to grow forever faster than it has), and never below 0%.
  const terminalGrowth = Math.max(0, Math.min(0.025, riskFreeRate, g0));
  const growth = linearFade({ start: g0, end: terminalGrowth, steps: HORIZON_YEARS }).value;
  const m = clamp(margin, 0.01, 0.6);
  return {
    revenueGrowth: growth,
    ebitMargin: Array.from({ length: HORIZON_YEARS }, () => m),
    taxRate: clamp(recentMean(s.rows, (r) => r.taxRate) ?? 0.21, 0.1, 0.3),
    daPctRevenue: clamp(recentMean(s.rows, (r) => r.daPct) ?? 0.03, 0, 0.25),
    capexPctRevenue: clamp(recentMean(s.rows, (r) => r.capexPct) ?? 0.04, 0, 0.3),
    nwcPctOfRevenueChange: clamp(s.nwcRatio ?? 0, -0.3, 0.5),
    terminalGrowth,
    equityRiskPremium: 0.05,
    preTaxCostOfDebt: clamp(s.observedCostOfDebt ?? riskFreeRate + 0.015, 0.02, 0.1),
    rationale: {
      growth: "Fades linearly from the recent revenue CAGR to the terminal growth rate.",
      margins: "Held at the recent average operating margin.",
      other:
        "Tax, D&A, capex and working capital use recent filing averages; ERP is a standard 5% assumption.",
    },
  };
}

/**
 * Expand the model's years-1–5 proposal into the full forecast: growth fades linearly from the year-5 rate to the
 * terminal rate over the remaining years (the last forecast year equals terminal growth); margins hold at year 5.
 */
export function expandAssumptions<
  T extends { revenueGrowth: number[]; ebitMargin: number[]; terminalGrowth: number },
>(p: T): T {
  const extra = HORIZON_YEARS - EXPLICIT_YEARS;
  const g5 = p.revenueGrowth[EXPLICIT_YEARS - 1] as number;
  const tail = linearFade({ start: g5, end: p.terminalGrowth, steps: extra + 1 }).value.slice(1);
  const m5 = p.ebitMargin[EXPLICIT_YEARS - 1] as number;
  return {
    ...p,
    revenueGrowth: [...p.revenueGrowth, ...tail],
    ebitMargin: [...p.ebitMargin, ...Array.from({ length: extra }, () => m5)],
  };
}

/** The baseline as the model sees it: years 1–5 only (code fades the rest). */
const modelView = (b: AssumptionSet): AssumptionSet => ({
  ...b,
  revenueGrowth: b.revenueGrowth.slice(0, EXPLICIT_YEARS),
  ebitMargin: b.ebitMargin.slice(0, EXPLICIT_YEARS),
});

/** Zod schema for the model's proposal: hard bounds + closeness to the filing-based baseline. */
export function assumptionSetSchema(base: AssumptionSet) {
  const near = (b: number, tol: number) => (v: number) => Math.abs(v - b) <= tol;
  return z
    .object({
      revenueGrowth: z.array(z.number().min(-0.3).max(0.6)).length(EXPLICIT_YEARS),
      ebitMargin: z.array(z.number().min(0).max(0.7)).length(EXPLICIT_YEARS),
      taxRate: z.number().min(0.05).max(0.35),
      daPctRevenue: z.number().min(0).max(0.25),
      capexPctRevenue: z.number().min(0).max(0.35),
      nwcPctOfRevenueChange: z.number().min(-0.5).max(0.5),
      terminalGrowth: z.number().min(0).max(0.035),
      equityRiskPremium: z.number().min(0.03).max(0.08),
      preTaxCostOfDebt: z.number().min(0.01).max(0.15),
      rationale: z.object({
        growth: z.string().max(500),
        margins: z.string().max(500),
        other: z.string().max(500),
      }),
    })
    .superRefine((v, ctx) => {
      v.revenueGrowth.forEach((g, k) => {
        if (!near(base.revenueGrowth[k] ?? 0, 0.1)(g)) {
          ctx.addIssue({
            code: "custom",
            message: `revenueGrowth[${k}] must be within ±10 points of the baseline ${(base.revenueGrowth[k] ?? 0).toFixed(3)}`,
          });
        }
      });
      v.ebitMargin.forEach((m, k) => {
        if (!near(base.ebitMargin[k] ?? 0, 0.08)(m)) {
          ctx.addIssue({
            code: "custom",
            message: `ebitMargin[${k}] must be within ±8 points of the baseline ${(base.ebitMargin[k] ?? 0).toFixed(3)}`,
          });
        }
      });
      // Terminal growth may not exceed the year-5 growth. Exception: when the baseline itself has growth rising
      // toward its terminal rate (a shrinking company fading up to 0%), terminal growth may equal the baseline's.
      const g5 = v.revenueGrowth[EXPLICIT_YEARS - 1] ?? 1;
      const baseG5 = base.revenueGrowth[EXPLICIT_YEARS - 1] ?? g5;
      const baselineRising = base.terminalGrowth > baseG5 + 0.005;
      const limit = Math.max(g5 + 0.005, baselineRising ? base.terminalGrowth : Number.NEGATIVE_INFINITY);
      if (v.terminalGrowth > limit) {
        ctx.addIssue({
          code: "custom",
          message: `terminalGrowth must not exceed the year-5 revenue growth (${g5.toFixed(3)})`,
        });
      }
    });
}

export interface ProposeContext {
  llm: LlmClient;
  summary: HistorySummary;
  baseline: AssumptionSet;
  sector: string | null;
  industry: string | null;
  riskFreeRate: number;
}

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);

/** Text table the model sees. All figures were computed by code; the model only adjusts the assumptions. */
export function describeHistory(s: HistorySummary): string {
  const header = "fiscal_year_end | revenue_growth | ebit_margin | da_%rev | capex_%rev | tax_rate";
  const lines = s.rows.map(
    (r) =>
      `${r.end} | ${pct(r.growth)} | ${pct(r.ebitMargin)} | ${pct(r.daPct)} | ${pct(r.capexPct)} | ${pct(r.taxRate)}`,
  );
  return [header, ...lines].join("\n");
}

/**
 * Ask the model to adjust the baseline. On any failure (invalid output, provider error) fall back to the
 * baseline and say so — the valuation must never depend on the model being available.
 */
export async function proposeAssumptions(
  ctx: ProposeContext,
): Promise<{ assumptions: AssumptionSet; usedFallback: boolean; note: string | null }> {
  try {
    const { data } = await ctx.llm.structured({
      node: "modeling.assumptions",
      group: "dp-producer-paid", // repeatable valuations: the free-tier rotation varies run to run
      system: loadPrompt("assumptions.v1"),
      messages: [
        {
          role: "user",
          content: [
            `Company: ${ctx.summary.name} (${ctx.summary.ticker}); sector: ${ctx.sector ?? "unknown"}; industry: ${ctx.industry ?? "unknown"}.`,
            `Risk-free rate (10y Treasury): ${pct(ctx.riskFreeRate)}.`,
            "",
            "Historical ratios computed from the filings (newest first):",
            describeHistory(ctx.summary),
            "",
            "Baseline assumptions (computed by code). Adjust only where you have a reason:",
            JSON.stringify(modelView(ctx.baseline)),
          ].join("\n"),
        },
      ],
      schema: assumptionSetSchema(ctx.baseline),
      schemaName: "set_assumptions",
      schemaDescription:
        "Forecast assumptions for years 1-5 of a 10-year DCF; code fades years 6-10 to terminal growth.",
      maxTokens: 1200,
      temperature: 0,
    });
    return { assumptions: expandAssumptions(data), usedFallback: false, note: null };
  } catch (e) {
    return {
      assumptions: ctx.baseline,
      usedFallback: true,
      note: `Model-proposed assumptions unavailable (${e instanceof Error ? e.message.slice(0, 400) : "error"}); using filing-based baseline.`,
    };
  }
}
