import { linearFade } from "@dealpilot/finance";
import type { LlmClient } from "@dealpilot/llm";
import { z } from "zod";
import { loadPrompt } from "../prompts.ts";
import { type HistorySummary, recentMean, recentRevenueCagr, UnsupportedCompanyError } from "./summary.ts";

export const HORIZON_YEARS = 5;

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
  const terminalGrowth = Math.min(0.025, Math.max(0, riskFreeRate));
  const g0 = clamp(recentRevenueCagr(s.rows) ?? 0.05, -0.05, 0.25);
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

/** Zod schema for the model's proposal: hard bounds + closeness to the filing-based baseline. */
export function assumptionSetSchema(base: AssumptionSet) {
  const near = (b: number, tol: number) => (v: number) => Math.abs(v - b) <= tol;
  return z
    .object({
      revenueGrowth: z.array(z.number().min(-0.3).max(0.6)).length(HORIZON_YEARS),
      ebitMargin: z.array(z.number().min(0).max(0.7)).length(HORIZON_YEARS),
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
      if (v.terminalGrowth > (v.revenueGrowth[HORIZON_YEARS - 1] ?? 1) + 0.005) {
        ctx.addIssue({
          code: "custom",
          message: "terminalGrowth must not exceed the final-year revenue growth",
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
      group: "dp-producer",
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
            JSON.stringify(ctx.baseline),
          ].join("\n"),
        },
      ],
      schema: assumptionSetSchema(ctx.baseline),
      schemaName: "set_assumptions",
      schemaDescription: "Forecast assumptions for a 5-year DCF.",
      maxTokens: 1200,
      temperature: 0.2,
    });
    return { assumptions: data, usedFallback: false, note: null };
  } catch (e) {
    return {
      assumptions: ctx.baseline,
      usedFallback: true,
      note: `Model-proposed assumptions unavailable (${e instanceof Error ? e.message.slice(0, 120) : "error"}); using filing-based baseline.`,
    };
  }
}
