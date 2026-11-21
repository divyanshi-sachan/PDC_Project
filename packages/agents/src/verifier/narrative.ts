/**
 * Narrative cross-check by a model from a DIFFERENT family than the producers (Claude vs the free-tier rotation):
 * does the prose (rationales and commentary) contradict the numbers it sits next to? Warnings only — the numbers
 * themselves are verified deterministically. The model may not write digits, so it cannot introduce figures.
 */
import type { LlmClient } from "@dealpilot/llm";
import type { Defect, Panel } from "@dealpilot/shared";
import { z } from "zod";
import { loadPrompt } from "../prompts.ts";
import { defect } from "./recompute.ts";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export async function narrativeReview(
  llm: LlmClient,
  panel: Panel,
  commentary: string,
): Promise<{ defects: Defect[]; items: number }> {
  const growth = panel.assumptions
    .filter((a) => a.key.startsWith("revenue_growth_y"))
    .map((a) => pct(a.value));
  const margins = panel.assumptions.filter((a) => a.key.startsWith("ebit_margin_y")).map((a) => pct(a.value));
  const rationales = panel.assumptions
    .filter((a) => a.rationale && a.source === "assumption")
    .map((a) => `${a.label}: ${a.rationale}`);
  const brief = [
    `Company: ${panel.companyName}.`,
    `Revenue growth path (years 1 to ${growth.length}): ${growth.join(", ")}.`,
    `EBIT margin path: ${margins.join(", ")}.`,
    `DCF value ${panel.valuation.impliedUpsidePct === null ? "vs market unknown" : panel.valuation.impliedUpsidePct >= 0 ? "above" : "below"} the market price.`,
    `Rationales written for the assumptions:\n${rationales.join("\n") || "none"}`,
    `Commentary shown to the reader:\n${commentary || "none"}`,
  ].join("\n");

  const schema = z
    .object({
      contradictions: z
        .array(
          z.object({
            subject: z.string().max(80),
            explanation: z.string().max(240),
          }),
        )
        .max(3),
    })
    .refine((v) => v.contradictions.every((c) => !/\d/.test(c.subject + c.explanation)), {
      message: "subject and explanation must not contain digits",
    });
  try {
    const { data } = await llm.structured({
      node: "verifier.narrative",
      group: "dp-verifier",
      system: loadPrompt("verifier.v1"),
      messages: [{ role: "user", content: brief }],
      schema,
      schemaName: "report_contradictions",
      schemaDescription: "List places where the prose contradicts the stated numbers (empty if none).",
      maxTokens: 400,
      temperature: 0,
    });
    return {
      items: 1,
      defects: data.contradictions.map((c, k) =>
        defect({
          type: "inconsistency",
          severity: "warning",
          ownerNode: "respond",
          subject: `narrative:${k + 1}`,
          detail: `${c.subject}: ${c.explanation}`,
        }),
      ),
    };
  } catch {
    return { defects: [], items: 0 }; // the narrative check is advisory; the numeric checks are the gate
  }
}
