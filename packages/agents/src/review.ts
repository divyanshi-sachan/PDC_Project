/** Review stage: forensic red flags + skeptic challenge, producing the findings attached to the panel. */
import type { Db } from "@dealpilot/db";
import type { LlmClient } from "@dealpilot/llm";
import type { Embedder } from "@dealpilot/sources";
import { runForensicWithEvidence, sortFindings } from "./forensic/index.ts";
import type { AnalysisSnapshot } from "./modeling/snapshot.ts";
import { runScenarios, runSkeptic } from "./skeptic/index.ts";
import { assemblePanel, type ReviewOutput } from "./verifier/repair.ts";

export interface ReviewDeps {
  llm: LlmClient;
  db: Db;
  embedder: Embedder;
}

/** Forensic rules (+ filing-text stage), then the Skeptic's challenge of the assumptions given the scenarios. */
export async function runReview(deps: ReviewDeps, snapshot: AnalysisSnapshot): Promise<ReviewOutput> {
  const forensic = await runForensicWithEvidence(deps, {
    history: snapshot.history,
    cik: snapshot.cik,
    companyName: snapshot.companyName,
    withText: true,
  });
  const base: ReviewOutput = {
    findings: forensic.findings,
    evidence: Object.fromEntries(forensic.evidence.map((e) => [e.id, e])),
  };
  const panel = assemblePanel(snapshot, base);
  const skeptic = await runSkeptic(
    { llm: deps.llm },
    { panel, scenarios: runScenarios(snapshot), findings: forensic.findings },
  );
  return { findings: sortFindings([...forensic.findings, ...skeptic]), evidence: base.evidence };
}
