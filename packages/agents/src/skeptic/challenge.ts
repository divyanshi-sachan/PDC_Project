import type { LlmClient } from "@dealpilot/llm";
import type { Assumption, Finding, Panel, Scenario } from "@dealpilot/shared";
import { z } from "zod";
import { loadPrompt } from "../prompts.ts";

/** Keys a challenge may target besides the panel's own assumption keys. */
export const EXTRA_CHALLENGE_KEYS = ["peers", "terminal_value", "wacc", "market_price"] as const;

const hasDigit = (s: string): boolean => /\d/.test(s);

/** Output schema for the allowed key set of one panel. Digits are banned so the model cannot introduce numbers. */
function challengesSchema(allowed: ReadonlySet<string>) {
  return z
    .object({
      challenges: z
        .array(
          z.object({
            assumptionKey: z.string(),
            title: z.string().min(3).max(80),
            argument: z.string().min(10).max(300),
            severity: z.enum(["high", "medium", "low"]),
          }),
        )
        .max(5),
    })
    .superRefine((v, ctx) => {
      const seen = new Set<string>();
      v.challenges.forEach((c, i) => {
        if (!allowed.has(c.assumptionKey))
          ctx.addIssue({
            code: "custom",
            path: ["challenges", i, "assumptionKey"],
            message: `assumptionKey must be one of: ${[...allowed].join(", ")}`,
          });
        if (seen.has(c.assumptionKey))
          ctx.addIssue({
            code: "custom",
            path: ["challenges", i, "assumptionKey"],
            message: "each assumptionKey may be used only once",
          });
        seen.add(c.assumptionKey);
        if (hasDigit(c.title) || hasDigit(c.argument))
          ctx.addIssue({
            code: "custom",
            path: ["challenges", i],
            message: "title and argument must not contain any digits or numbers",
          });
      });
    });
}

const fmtAssumption = (a: Assumption): string => {
  const v =
    a.unit === "pct"
      ? `${(a.value * 100).toFixed(2)}%`
      : a.unit === "usd"
        ? `$${a.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
        : a.unit === "multiple"
          ? `${a.value.toFixed(2)}x`
          : a.unit === "years"
            ? `${a.value.toFixed(1)} years`
            : a.value.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return `- ${a.key} | ${a.label} | ${v} | source: ${a.source} | ${a.rationale ?? "no rationale"}`;
};

function brief(panel: Panel, scenarios: Scenario[], findings: Finding[]): string {
  const v = panel.valuation;
  const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
  const forensic = findings.filter((f) => f.agent === "forensic").map((f) => f.title);
  return [
    `Company: ${panel.companyName} (${panel.ticker})`,
    "",
    "Assumptions (key | label | value | source | rationale):",
    ...panel.assumptions.map(fmtAssumption),
    "",
    "Scenarios (value per share):",
    ...(scenarios.length
      ? scenarios.map((s) => `- ${s.name}: $${s.perShare.toFixed(2)} (${pct(s.deltaVsBase)} vs base)`)
      : ["- none"]),
    "",
    `Valuation: DCF $${v.perShare.toFixed(2)} per share, WACC ${pct(v.wacc, 2)}, terminal growth ${pct(v.terminalGrowth)}${
      v.terminalShareOfEv !== null
        ? `, terminal value is ${pct(v.terminalShareOfEv, 0)} of enterprise value`
        : ""
    }${panel.price !== null ? `, market price $${panel.price.toFixed(2)}` : ""}.`,
    `Peers used: ${panel.comps.peers.filter((p) => p.included).length} of ${panel.comps.peers.length}.`,
    "",
    `Model notes: ${panel.risks.map((r) => r.title).join("; ") || "none"}.`,
    `Forensic findings: ${forensic.join("; ") || "none"}.`,
    "",
    `Allowed assumptionKey values: ${[...panel.assumptions.map((a) => a.key), ...EXTRA_CHALLENGE_KEYS].join(", ")}`,
  ].join("\n");
}

const unavailable = (reason: string): Finding => ({
  id: "skeptic:unavailable",
  agent: "skeptic",
  severity: "low",
  title: "Skeptic review unavailable",
  detail: `The skeptic review could not be completed: ${reason.replace(/\s+/g, " ").slice(0, 240)}`,
  evidenceIds: [],
  basis: null,
});

/**
 * LLM skeptic: argues against the model's assumptions. Its prose is rejected if it contains a digit, so it can
 * never introduce a number. Any failure yields one low-severity "unavailable" finding; this never throws.
 * A panel with no assumptions returns [] without calling the model.
 */
export async function runSkeptic(
  deps: { llm: LlmClient },
  ctx: { panel: Panel; scenarios: Scenario[]; findings: Finding[] },
): Promise<Finding[]> {
  const { panel } = ctx;
  if (panel.assumptions.length === 0) return [];
  const byKey = new Map(panel.assumptions.map((a) => [a.key, a]));
  const allowed = new Set<string>([...byKey.keys(), ...EXTRA_CHALLENGE_KEYS]);
  try {
    const { data } = await deps.llm.structured({
      node: "skeptic.challenge",
      group: "dp-verifier",
      system: loadPrompt("skeptic.v1"),
      messages: [{ role: "user", content: brief(panel, ctx.scenarios, ctx.findings) }],
      schema: challengesSchema(allowed),
      schemaName: "skeptic_challenges",
      maxTokens: 900,
      temperature: 0,
      maxRetries: 2,
    });
    return data.challenges.map((c) => {
      const evidenceId = byKey.get(c.assumptionKey)?.evidenceId ?? null;
      return {
        id: `skeptic:${c.assumptionKey}`,
        agent: "skeptic" as const,
        severity: c.severity,
        title: c.title,
        detail: c.argument,
        evidenceIds: evidenceId !== null && panel.evidence[evidenceId] ? [evidenceId] : [],
        basis: c.assumptionKey,
      };
    });
  } catch (e) {
    return [unavailable(e instanceof Error ? e.message : "unknown error")];
  }
}
