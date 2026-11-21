/**
 * Verify → repair loop. Each round the Verifier checks the candidate deliverable; open errors are routed back to
 * the agent that owns them (research / modeling / respond), the candidate is rebuilt from clean sources, and the
 * Verifier checks again. After `maxRepairs` rounds an error that persists is marked `unresolved` and surfaced.
 */
import type { Defect, Finding, Panel, VerificationReport } from "@dealpilot/shared";
import { type AnalysisSnapshot, computePanel } from "../modeling/index.ts";
import type { CompanyHistory } from "../research/types.ts";
import { composeMessage } from "../respond.ts";
import { runScenarios } from "../skeptic/index.ts";
import { buildReport, repairable, runVerifier, trackDefects, type VerifierDeps } from "./index.ts";

export interface Candidate {
  panel: Panel;
  /** The chat message for this panel, without the verification line. */
  text: string;
  commentary: string | null;
  changes: string[];
}

export interface ReviewOutput {
  findings: Finding[];
  /** Extra evidence the findings cite (filing text passages). */
  evidence: Panel["evidence"];
}

export interface RepairDeps {
  verifier: VerifierDeps;
  /** Re-read filing data (research repair). */
  refetchHistory?: (ticker: string) => Promise<CompanyHistory>;
  maxRepairs?: number;
  /** TEST HOOK: corrupt the candidate before each verification (attempt 0 = first draft, 1.. = after repairs). */
  inject?: (c: Candidate, attempt: number) => Candidate;
  /** Progress reporting. */
  onRound?: (info: { round: number; open: Defect[]; repairing: string[] }) => Promise<void>;
}

/** Evidence referenced by findings, taken from the cited history facts and any filing-text passages. */
function findingEvidence(snapshot: AnalysisSnapshot, review: ReviewOutput): Panel["evidence"] {
  const out: Panel["evidence"] = { ...review.evidence };
  const wanted = new Set(review.findings.flatMap((f) => f.evidenceIds));
  for (const list of Object.values(snapshot.history.items)) {
    for (const f of list ?? []) if (wanted.has(f.evidence.id)) out[f.evidence.id] = f.evidence;
  }
  return out;
}

/** Panel for a snapshot with the review (forensic + skeptic) and scenarios attached. */
export function assemblePanel(snapshot: AnalysisSnapshot, review: ReviewOutput): Panel {
  const base = computePanel(snapshot);
  return {
    ...base,
    findings: review.findings,
    scenarios: runScenarios(snapshot),
    evidence: { ...base.evidence, ...findingEvidence(snapshot, review) },
  };
}

export const verificationLine = (r: VerificationReport): string => {
  const passed = r.checks.filter((c) => c.passed).length;
  const parts = [`Independent verification: ${passed} of ${r.checks.length} checks passed`];
  if (r.summary.fixed)
    parts.push(`${r.summary.fixed} defect${r.summary.fixed === 1 ? "" : "s"} found and corrected`);
  if (r.summary.unresolved)
    parts.push(
      `${r.summary.unresolved} UNRESOLVED defect${r.summary.unresolved === 1 ? "" : "s"}, so the affected figures are unverified (see the Defects tab)`,
    );
  return `${parts.join("; ")}.`;
};

export async function verifyAndRepair(
  deps: RepairDeps,
  input: { snapshot: AnalysisSnapshot; candidate: Candidate; review: ReviewOutput },
): Promise<{ snapshot: AnalysisSnapshot; candidate: Candidate; report: VerificationReport }> {
  const maxRepairs = deps.maxRepairs ?? 2;
  let { snapshot, candidate } = input;
  let tracked: Defect[] = [];
  let round = 0;
  let checks: Awaited<ReturnType<typeof runVerifier>>["checks"] = [];

  for (;;) {
    if (deps.inject) candidate = deps.inject(candidate, round);
    const result = await runVerifier(deps.verifier, {
      panel: candidate.panel,
      message: candidate.text,
      changes: candidate.changes,
      commentary: candidate.commentary ?? "",
    });
    checks = result.checks;
    tracked = trackDefects(tracked, result.defects, maxRepairs);
    const todo = repairable(tracked);
    if (todo.length === 0 || round >= maxRepairs) break;

    const owners = new Set(todo.map((d) => d.ownerNode));
    round++;
    await deps.onRound?.({ round, open: todo, repairing: [...owners] });

    let panelChanged = false;
    if (owners.has("research") && deps.refetchHistory) {
      snapshot = { ...snapshot, history: await deps.refetchHistory(snapshot.ticker) };
      panelChanged = true;
    }
    if (owners.has("research") || owners.has("modeling")) panelChanged = true;
    const panel = panelChanged ? assemblePanel(snapshot, input.review) : candidate.panel;
    // Commentary is kept only if it is clean; the message is always regenerated from the panel.
    const commentary = candidate.commentary && !/\d/.test(candidate.commentary) ? candidate.commentary : null;
    candidate = {
      ...candidate,
      panel,
      commentary,
      text: composeMessage(panel, candidate.changes, commentary),
    };
  }

  const report = buildReport(checks, tracked, round, deps.verifier.now);
  return {
    snapshot,
    candidate: { ...candidate, panel: { ...candidate.panel, verification: report } },
    report,
  };
}
