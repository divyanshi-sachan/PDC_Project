/**
 * Audit trail: what was asked, which steps ran, which models were called and what they cost, every input with its
 * provenance, the formulas used, and the independent verification result. A hash of the panel lets a reader confirm
 * that the workbook, memo and audit trail describe the same result.
 */
import { createHash } from "node:crypto";
import type { ChatEvent, Panel } from "@dealpilot/shared";

export interface LlmCallRecord {
  node: string;
  model: string | null;
  group?: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number | null;
}

export interface AuditInput {
  panel: Panel;
  request: string;
  /** Step events of this turn, in order. */
  events: ChatEvent[];
  llmCalls: LlmCallRecord[];
  generatedAt: Date;
}

export interface AuditTrail {
  json: string;
  markdown: string;
  panelSha256: string;
}

/** Stable JSON: object keys sorted, so the same panel always hashes the same. */
function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  if (x !== null && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x) ?? "null";
}

export const panelHash = (panel: Panel): string =>
  createHash("sha256").update(canonical(panel)).digest("hex");

export function buildAuditTrail(i: AuditInput): AuditTrail {
  const { panel } = i;
  const sha = panelHash(panel);
  const steps = i.events.flatMap((e) =>
    e.type === "step" && e.status !== "started"
      ? [{ node: e.node, status: e.status, label: e.label, detail: e.detail }]
      : [],
  );
  const totalCost = i.llmCalls.reduce((a, c) => a + c.costUsd, 0);
  const vr = panel.verification;
  const doc = {
    schema: "dealpilot.audit/1",
    generatedAt: i.generatedAt.toISOString(),
    request: i.request,
    company: { ticker: panel.ticker, name: panel.companyName, cik: panel.cik },
    asOf: panel.asOf,
    panelSha256: sha,
    result: {
      perShare: panel.valuation.perShare,
      enterpriseValue: panel.valuation.enterpriseValue,
      wacc: panel.valuation.wacc,
      terminalGrowth: panel.valuation.terminalGrowth,
    },
    verification: vr
      ? {
          verified: vr.summary.unresolved === 0 && vr.summary.errorsOpen === 0,
          repairRounds: vr.repairRounds,
          summary: vr.summary,
          checks: vr.checks,
          defects: vr.defects,
        }
      : { verified: false, reason: "verification did not run" },
    steps,
    llmCalls: i.llmCalls,
    cost: { totalUsd: totalCost, llmCalls: i.llmCalls.length },
    formulas: panel.formulaIds,
    inputs: panel.assumptions.map((a) => ({
      key: a.key,
      label: a.label,
      value: a.value,
      unit: a.unit,
      source: a.source,
      evidenceId: a.evidenceId,
      rationale: a.rationale,
    })),
    evidence: Object.values(panel.evidence),
    findings: panel.findings,
    scenarios: panel.scenarios,
  };

  const verification = !vr
    ? "NOT VERIFIED"
    : vr.summary.unresolved > 0
      ? `UNRESOLVED defects: ${vr.summary.unresolved}`
      : `${vr.checks.filter((c) => c.passed).length} of ${vr.checks.length} checks passed, ${vr.summary.fixed} defect(s) corrected in ${vr.repairRounds} repair round(s)`;
  const md: string[] = [
    `# Audit trail: ${panel.companyName} (${panel.ticker})`,
    "",
    `- Generated: ${doc.generatedAt}`,
    `- Request: ${i.request}`,
    `- Result fingerprint (SHA-256 of the panel): \`${sha}\``,
    `- Verification: ${verification}`,
    `- Model calls: ${i.llmCalls.length}, total cost $${totalCost.toFixed(4)}`,
    "",
    "## Timeline",
  ];
  for (const s of steps)
    md.push(
      `- [${s.node}] ${s.status === "failed" ? "FAILED: " : ""}${s.label}${s.detail ? ` (${s.detail})` : ""}`,
    );
  md.push(
    "",
    "## Model calls",
    "| Node | Model | Tokens in/out | Cost | Latency |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const c of i.llmCalls)
    md.push(
      `| ${c.node} | ${c.model ?? "n/a"} | ${c.inputTokens}/${c.outputTokens} | $${c.costUsd.toFixed(5)} | ${c.latencyMs ?? "n/a"} ms |`,
    );
  md.push("", "## Defects");
  if (!vr || vr.defects.length === 0) md.push(vr ? "None." : "Verification did not run.");
  else
    for (const d of vr.defects)
      md.push(`- [${d.status}] ${d.type} (${d.ownerNode}, ${d.severity}): ${d.detail}`);
  md.push("", "## Inputs and provenance");
  for (const a of panel.assumptions)
    md.push(
      `- ${a.label} = ${a.value} (${a.unit}), ${a.source}${a.evidenceId ? `, evidence \`${a.evidenceId}\`` : ""}`,
    );
  md.push("", "## Formulas used", "", panel.formulaIds.map((f) => `\`${f}\``).join(", "));
  return { json: JSON.stringify(doc, null, 2), markdown: md.join("\n"), panelSha256: sha };
}
