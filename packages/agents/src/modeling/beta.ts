import { debtToEquity, relevered } from "@dealpilot/finance";
import type { LlmClient } from "@dealpilot/llm";
import type { IndustryBetaTable } from "@dealpilot/market";
import { z } from "zod";
import { loadPrompt } from "../prompts.ts";

export interface IndustryBetaResult {
  /** Damodaran industry name. */
  industry: string;
  /** Pure-play (cash-corrected) unlevered industry beta. */
  unleveredBeta: number;
  /** Company market debt / equity used to relever. */
  debtToEquity: number;
  /** Relevered beta used in CAPM. */
  beta: number;
  /** One-line, human-readable basis shown next to the number. */
  basis: string;
}

/** The model picks the best-matching Damodaran industry; it can only choose a name from the real list. */
export async function selectIndustry(
  llm: LlmClient,
  table: IndustryBetaTable,
  ctx: { name: string; sector: string | null; industry: string | null },
): Promise<{ industry: string; rationale: string }> {
  const schema = z.object({
    industry: z.string().refine((s) => table.find(s) !== undefined, {
      message: "industry must be exactly one of the listed Damodaran industry names",
    }),
    rationale: z.string().max(200),
  });
  const { data } = await llm.structured({
    node: "modeling.industry",
    group: "dp-producer-paid", // consistent pick: the industry choice moves WACC more than most assumptions
    system: loadPrompt("industry.v1"),
    messages: [
      {
        role: "user",
        content: `Company: ${ctx.name}; sector: ${ctx.sector ?? "unknown"}; industry: ${ctx.industry ?? "unknown"}.\nIndustries:\n${table.names().join("\n")}`,
      },
    ],
    schema,
    schemaName: "select_industry",
    schemaDescription: "Pick the single best-matching Damodaran industry.",
    maxTokens: 200,
    temperature: 0,
  });
  const found = table.find(data.industry);
  return { industry: found?.name ?? data.industry, rationale: data.rationale };
}

/**
 * Industry beta relevered to the company's capital structure:
 * β_L = β_U(corrected for cash) × (1 + (1 − t) × D/E), D/E at market value. All math is in `@dealpilot/finance`.
 */
export function industryBeta(
  table: IndustryBetaTable,
  industryName: string,
  firm: { totalDebt: number; marketCap: number; taxRate: number },
): IndustryBetaResult {
  const ind = table.find(industryName);
  if (!ind) throw new Error(`Unknown Damodaran industry: ${industryName}`);
  const de = debtToEquity({ totalDebt: firm.totalDebt, shareholdersEquity: firm.marketCap }).value;
  const beta = relevered({
    unleveredBeta: ind.unleveredBetaCorrectedForCash,
    debtToEquity: de,
    taxRate: firm.taxRate,
  }).value;
  return {
    industry: ind.name,
    unleveredBeta: ind.unleveredBetaCorrectedForCash,
    debtToEquity: de,
    beta,
    basis: `Damodaran industry beta (${ind.name}, ${table.updated}): unlevered ${ind.unleveredBetaCorrectedForCash.toFixed(2)}, relevered at D/E ${de.toFixed(2)}`,
  };
}
