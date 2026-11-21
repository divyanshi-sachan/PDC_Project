import type { Db } from "@dealpilot/db";
import type { LlmClient } from "@dealpilot/llm";
import type { Evidence, Finding } from "@dealpilot/shared";
import type { Embedder } from "@dealpilot/sources";
import type { CompanyHistory } from "../research/types.ts";
import { forensicRules } from "./rules.ts";
import { reviewFilingText } from "./text.ts";

export * from "./rules.ts";
export * from "./text.ts";

export interface ForensicDeps {
  llm: LlmClient;
  db: Db;
  embedder: Embedder;
}

const RANK: Record<Finding["severity"], number> = { high: 0, medium: 1, low: 2 };

/** Severity (high first), then id. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.id.localeCompare(b.id));
}

/**
 * Forensic review: deterministic rules over the cited history, plus (when `withText` and deps are given) an
 * evidence-grounded reading of the filing text. Returns the findings and any filing-text Evidence they cite
 * (fact evidence ids resolve against the CompanyHistory). A failed text stage never fails the review: it is
 * reported as one low-severity finding.
 */
export async function runForensicWithEvidence(
  deps: ForensicDeps | undefined,
  ctx: { history: CompanyHistory; cik: string; companyName: string; withText?: boolean },
): Promise<{ findings: Finding[]; evidence: Evidence[] }> {
  const findings = forensicRules(ctx.history);
  const evidence: Evidence[] = [];
  if (ctx.withText && deps) {
    try {
      const r = await reviewFilingText(deps, { cik: ctx.cik, companyName: ctx.companyName });
      findings.push(...r.findings);
      evidence.push(...r.evidence);
    } catch {
      findings.push({
        id: "forensic:text:unavailable",
        agent: "forensic",
        severity: "low",
        title: "Filing-text review unavailable",
        detail:
          "The automated reading of the filing text could not be completed, so text-based red flags were not checked.",
        evidenceIds: [],
        basis: "text:unavailable",
      });
    }
  }
  return { findings: sortFindings(findings), evidence };
}

/** {@link runForensicWithEvidence}, findings only. */
export async function runForensic(
  deps: ForensicDeps | undefined,
  ctx: { history: CompanyHistory; cik: string; companyName: string; withText?: boolean },
): Promise<Finding[]> {
  return (await runForensicWithEvidence(deps, ctx)).findings;
}
