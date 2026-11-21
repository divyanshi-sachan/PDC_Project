import type { LlmClient } from "@dealpilot/llm";
import type { Citation, Panel } from "@dealpilot/shared";
import { z } from "zod";
import { loadPrompt } from "./prompts.ts";

const usd = (x: number): string => {
  const a = Math.abs(x);
  const sign = x < 0 ? "-" : "";
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  return `${sign}$${a.toFixed(2)}`;
};
const share = (x: number) => `$${x.toFixed(2)}`;
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

/** Evidence-backed citations for the headline inputs. */
export function headlineCitations(panel: Panel): Citation[] {
  const labels: Record<string, string> = {
    revenue_base: "Base-year revenue (10-K)",
    diluted_shares: "Diluted shares (10-K)",
    total_debt: "Total debt (10-K)",
    cash: "Cash (10-K)",
    price: "Share price (market data)",
    beta: "Beta (market data)",
    risk_free: "10-year Treasury yield",
  };
  const out: Citation[] = [];
  for (const a of panel.assumptions) {
    const label = labels[a.key];
    if (label && a.evidenceId && panel.evidence[a.evidenceId]) out.push({ evidenceId: a.evidenceId, label });
  }
  return out;
}

/**
 * The factual part of the answer. Every figure was computed by `@dealpilot/finance`; this function only
 * formats them. `changes` lists user overrides that produced this result.
 */
export function formatAnalysisMessage(
  panel: Panel,
  changes: string[] = [],
): { text: string; citations: Citation[] } {
  const v = panel.valuation;
  const lines: string[] = [];
  const vs =
    panel.price !== null && v.impliedUpsidePct !== null
      ? ` vs. ${share(panel.price)} market price (${pct(Math.abs(v.impliedUpsidePct))} ${v.impliedUpsidePct >= 0 ? "above" : "below"} market)`
      : "";
  lines.push(
    `**${panel.companyName} (${panel.ticker})**: DCF value **${share(v.perShare)} per share**${vs}.`,
  );
  if (changes.length) lines.push(`Applied: ${changes.join("; ")}.`);
  lines.push(
    `- Enterprise value ${usd(v.enterpriseValue)}, equity value ${usd(v.equityValue)}. WACC ${pct(v.wacc, 2)}, terminal growth ${pct(v.terminalGrowth, 1)}${v.terminalShareOfEv !== null ? `; the terminal value is ${pct(v.terminalShareOfEv, 0)} of enterprise value` : ""}.`,
  );
  const c = panel.comps.impliedPerShare;
  const n = panel.comps.peers.filter((p) => p.included).length;
  if (c)
    lines.push(
      `- Trading comps (${n} peers): ${share(c.low)}–${share(c.high)} per share, median ${share(c.median)}.`,
    );
  else lines.push("- Trading comps: not enough comparable data for a range.");
  const sc = (name: string) => panel.scenarios.find((s) => s.name === name);
  const [bear, base, bull] = [sc("bear"), sc("base"), sc("bull")];
  if (bear && base && bull)
    lines.push(
      `- Scenarios: bear ${share(bear.perShare)}, base ${share(base.perShare)}, bull ${share(bull.perShare)} per share.`,
    );
  if (panel.findings.length) {
    const count = (sev: string) => panel.findings.filter((f) => f.severity === sev).length;
    const parts = (["high", "medium", "low"] as const)
      .filter((s) => count(s) > 0)
      .map((s) => `${count(s)} ${s}`);
    lines.push(
      `- Forensic and skeptic review: ${parts.join(", ")} finding${panel.findings.length === 1 ? "" : "s"}.`,
    );
  }
  const flags = panel.risks.filter((r) => r.title !== "Data note").map((r) => r.title);
  const dataNotes = panel.risks.length - flags.length;
  if (flags.length || dataNotes) {
    lines.push(
      `- Notes: ${[...flags, ...(dataNotes ? [`${dataNotes} data note${dataNotes === 1 ? "" : "s"}`] : [])].join("; ")}.`,
    );
  }
  lines.push("Open the panel for the projection, sensitivity table, comps and every cited input.");
  return { text: lines.join("\n"), citations: headlineCitations(panel) };
}

/** Factual message plus optional commentary (the Verifier checks exactly this shape). */
export function composeMessage(panel: Panel, changes: string[], commentary: string | null): string {
  const base = formatAnalysisMessage(panel, changes).text;
  return commentary ? `${base}\n\n${commentary}` : base;
}

const CommentarySchema = z.object({
  commentary: z
    .string()
    .min(20)
    .max(600)
    .refine((s) => !/\d/.test(s), { message: "the commentary must not contain any digits or numbers" }),
});

/**
 * 2–3 sentences of qualitative context. The model never sees figures it could repeat and its output is rejected
 * if it contains a digit, so it cannot introduce numbers into the deliverable. Failure → no commentary.
 */
export async function writeCommentary(llm: LlmClient, panel: Panel): Promise<string | null> {
  const direction =
    panel.valuation.impliedUpsidePct === null
      ? "unknown"
      : panel.valuation.impliedUpsidePct >= 0
        ? "above the market price"
        : "below the market price";
  const brief = [
    `Company: ${panel.companyName}`,
    `DCF result is ${direction}.`,
    `Peers used: ${
      panel.comps.peers
        .filter((p) => p.included)
        .map((p) => p.name)
        .join(", ") || "none"
    }.`,
    `Model notes: ${panel.risks.map((r) => r.title).join("; ") || "none"}.`,
    `Key assumption themes: ${panel.assumptions
      .filter((a) => a.rationale && a.source === "assumption")
      .map((a) => a.rationale)
      .slice(0, 3)
      .join(" ")}`,
  ].join("\n");
  try {
    const { data } = await llm.structured({
      node: "respond.commentary",
      group: "dp-producer",
      system: loadPrompt("commentary.v1"),
      messages: [{ role: "user", content: brief }],
      schema: CommentarySchema,
      schemaName: "write_commentary",
      maxTokens: 300,
      temperature: 0.3,
      maxRetries: 2,
    });
    return data.commentary;
  } catch {
    return null;
  }
}
