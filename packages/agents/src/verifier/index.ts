/**
 * The independent Verifier. It sees only the DELIVERABLE (panel + message) and the SEC data service, never the
 * producing agents' prompts, state or helper code, and it recomputes figures with its own wiring of the finance
 * library. Defects are routed back to the owning agent (research / modeling / respond) for repair.
 */
import type { LlmClient } from "@dealpilot/llm";
import type { Defect, Panel, VerificationCheck, VerificationReport } from "@dealpilot/shared";
import type { EdgarClient } from "@dealpilot/sources";
import { resolveCitations } from "./citations.ts";
import { checkMessageConsistency } from "./consistency.ts";
import { checkIntegrity } from "./integrity.ts";
import { narrativeReview } from "./narrative.ts";
import { compareValuation, defect, MissingInputError, recomputeValuation } from "./recompute.ts";

export * from "./citations.ts";
export * from "./consistency.ts";
export * from "./integrity.ts";
export * from "./narrative.ts";
export { close, compareValuation, MissingInputError, recomputeValuation } from "./recompute.ts";

export interface VerifierDeps {
  /** SEC data client for re-resolving citations. Without it citations are checked for completeness only. */
  edgar?: EdgarClient;
  /** Cross-family model for the advisory narrative check. Without it that check is skipped. */
  llm?: LlmClient;
  now?: () => Date;
}

export interface VerifierInput {
  panel: Panel;
  /** The chat message as produced for this panel (before any verification summary). */
  message: string;
  /** Plain-language overrides the user asked for (shown in the message). */
  changes: string[];
  /** Commentary portion of the message (for the narrative check). */
  commentary?: string;
}

const hasError = (defects: Defect[]) => defects.some((d) => d.severity === "error");

export async function runVerifier(
  deps: VerifierDeps,
  input: VerifierInput,
): Promise<{ checks: VerificationCheck[]; defects: Defect[] }> {
  const checks: VerificationCheck[] = [];
  const all: Defect[] = [];
  const record = (name: string, defects: Defect[], items: number, note: string | null = null) => {
    checks.push({ name, passed: !hasError(defects), items, note });
    all.push(...defects);
  };

  // 1) Recompute the valuation from the stated assumptions with the Verifier's own wiring.
  try {
    const r = recomputeValuation(input.panel);
    const { defects, items } = compareValuation(input.panel, r);
    record("recompute_valuation", defects, items);
  } catch (e) {
    if (!(e instanceof MissingInputError)) throw e;
    record(
      "recompute_valuation",
      [
        defect({
          type: "integrity",
          severity: "error",
          ownerNode: "modeling",
          subject: "assumptions",
          detail: e.message,
        }),
      ],
      0,
    );
  }

  // 2) Internal identities and invariants.
  const integrity = checkIntegrity(input.panel);
  record("integrity", integrity.defects, integrity.items);

  // 3) Citations resolved against SEC data.
  const cites = await resolveCitations(deps.edgar, input.panel);
  record("resolve_citations", cites.defects, cites.items, cites.skipped);

  // 4) Message vs panel.
  const consistency = checkMessageConsistency(input.panel, input.message, input.changes);
  record("message_consistency", consistency.defects, consistency.items);

  // 5) Advisory narrative check by a different model family.
  if (deps.llm) {
    const n = await narrativeReview(deps.llm, input.panel, input.commentary ?? "");
    if (n.items > 0) record("narrative_review", n.defects, n.items, "advisory");
  }
  return { checks, defects: all };
}

export const defectKey = (d: Defect) => `${d.type}:${d.subject}`;

/**
 * Carry defect status across repair rounds. An error present again after a repair attempt gains a retry; once it has
 * used `maxRetries` repairs it is `unresolved` (surfaced, never hidden). An earlier error that is gone is `fixed`.
 */
export function trackDefects(previous: Defect[], current: Defect[], maxRetries: number): Defect[] {
  const prev = new Map(previous.map((d) => [defectKey(d), d]));
  const seen = new Set<string>();
  const out: Defect[] = [];
  for (const d of current) {
    const key = defectKey(d);
    seen.add(key);
    const p = prev.get(key);
    if (!p) {
      out.push({ ...d, status: "open", retries: 0 });
    } else {
      const retries = d.severity === "error" ? p.retries + 1 : p.retries;
      out.push({
        ...d,
        retries,
        status: d.severity === "error" && retries >= maxRetries ? "unresolved" : "open",
      });
    }
  }
  for (const p of previous) {
    if (!seen.has(defectKey(p)) && p.status !== "fixed") out.push({ ...p, status: "fixed" });
    else if (!seen.has(defectKey(p))) out.push(p);
  }
  return out;
}

export function buildReport(
  checks: VerificationCheck[],
  defects: Defect[],
  repairRounds: number,
  now: () => Date = () => new Date(),
): VerificationReport {
  return {
    checkedAt: now().toISOString(),
    repairRounds,
    checks,
    defects,
    summary: {
      errorsOpen: defects.filter((d) => d.severity === "error" && d.status === "open").length,
      warningsOpen: defects.filter((d) => d.severity === "warning" && d.status === "open").length,
      fixed: defects.filter((d) => d.status === "fixed").length,
      unresolved: defects.filter((d) => d.status === "unresolved").length,
    },
  };
}

/** Errors that still need a repair attempt (open errors, not yet out of retries). */
export const repairable = (defects: Defect[]) =>
  defects.filter((d) => d.severity === "error" && d.status === "open");
