import { z } from "zod";

/**
 * What a follow-up message can change ("use 9% WACC", "drop Dell", "bull case"). Unspecified fields are null.
 * Applying overrides re-runs ONLY the deterministic finance code — no filings are re-read.
 */
export const OverridesSchema = z.object({
  wacc: z.number().min(0.03).max(0.2).nullable().default(null),
  terminalGrowth: z.number().min(0).max(0.035).nullable().default(null),
  equityRiskPremium: z.number().min(0.03).max(0.08).nullable().default(null),
  beta: z.number().min(0.2).max(3).nullable().default(null),
  /** Added to each projected year's revenue growth (0.02 = +2 points). */
  revenueGrowthShift: z.number().min(-0.2).max(0.2).nullable().default(null),
  /** Added to each projected year's EBIT margin. */
  ebitMarginShift: z.number().min(-0.2).max(0.2).nullable().default(null),
  excludePeers: z.array(z.string()).default([]),
  /** A share price the user states (USD); replaces the market price and recomputes market cap. */
  price: z.number().positive().max(100_000).nullable().default(null),
});
export type Overrides = z.infer<typeof OverridesSchema>;

export const NO_OVERRIDES: Overrides = {
  wacc: null,
  terminalGrowth: null,
  equityRiskPremium: null,
  beta: null,
  revenueGrowthShift: null,
  ebitMarginShift: null,
  excludePeers: [],
  price: null,
};

/** Later overrides win; peer exclusions accumulate. */
export function mergeOverrides(prev: Overrides, next: Overrides): Overrides {
  return {
    wacc: next.wacc ?? prev.wacc,
    terminalGrowth: next.terminalGrowth ?? prev.terminalGrowth,
    equityRiskPremium: next.equityRiskPremium ?? prev.equityRiskPremium,
    beta: next.beta ?? prev.beta,
    revenueGrowthShift: next.revenueGrowthShift ?? prev.revenueGrowthShift,
    ebitMarginShift: next.ebitMarginShift ?? prev.ebitMarginShift,
    price: next.price ?? prev.price,
    excludePeers: [...new Set([...prev.excludePeers, ...next.excludePeers].map((t) => t.toUpperCase()))],
  };
}

export function describeOverrides(o: Overrides): string[] {
  const out: string[] = [];
  const p = (x: number) => `${(x * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
  if (o.wacc !== null) out.push(`WACC = ${p(o.wacc)}`);
  if (o.terminalGrowth !== null) out.push(`terminal growth = ${p(o.terminalGrowth)}`);
  if (o.equityRiskPremium !== null) out.push(`equity risk premium = ${p(o.equityRiskPremium)}`);
  if (o.beta !== null) out.push(`beta = ${o.beta}`);
  if (o.revenueGrowthShift !== null)
    out.push(`revenue growth ${o.revenueGrowthShift >= 0 ? "+" : ""}${p(o.revenueGrowthShift)} per year`);
  if (o.ebitMarginShift !== null)
    out.push(`EBIT margin ${o.ebitMarginShift >= 0 ? "+" : ""}${p(o.ebitMarginShift)}`);
  if (o.price !== null) out.push(`share price = $${o.price}`);
  if (o.excludePeers.length) out.push(`peers excluded: ${o.excludePeers.join(", ")}`);
  return out;
}
