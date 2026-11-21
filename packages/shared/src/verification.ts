import { z } from "zod";

/* ---------------------------------------------------------------- defects & verification */

/** What kind of problem the independent Verifier found. */
export const DefectTypeSchema = z.enum([
  "calc_mismatch", // a figure differs from the Verifier's own recomputation
  "integrity", // an internal identity or invariant is broken (EV − debt + cash ≠ equity, grid centre ≠ value, …)
  "citation_missing", // a figure that must be cited has no evidence, or the evidence id does not exist
  "citation_mismatch", // the cited filing does not contain the stated value (re-fetched from SEC)
  "citation_unsupported", // a quoted passage is not in the filing
  "period_mismatch", // period or unit of a cited fact does not match how it is used
  "inconsistency", // the chat message disagrees with the panel
]);
export type DefectType = z.infer<typeof DefectTypeSchema>;

/** Which agent can repair a defect (the Verifier routes it back there). */
export const DefectOwnerSchema = z.enum(["research", "modeling", "respond"]);
export type DefectOwner = z.infer<typeof DefectOwnerSchema>;

export const DefectSchema = z.object({
  id: z.string(),
  type: DefectTypeSchema,
  severity: z.enum(["error", "warning"]),
  ownerNode: DefectOwnerSchema,
  /** What was checked, e.g. "valuation.perShare", "assumption:revenue_base". */
  subject: z.string(),
  detail: z.string(),
  /** The Verifier's own value / the filing's value. */
  expected: z.union([z.number(), z.string()]).nullable().default(null),
  /** The value in the deliverable. */
  actual: z.union([z.number(), z.string()]).nullable().default(null),
  status: z.enum(["open", "fixed", "unresolved"]).default("open"),
  /** How many repair attempts were made. */
  retries: z.number().int().nonnegative().default(0),
});
export type Defect = z.infer<typeof DefectSchema>;

export const VerificationCheckSchema = z.object({
  /** e.g. "recompute_valuation", "resolve_citations", "integrity", "message_consistency". */
  name: z.string(),
  passed: z.boolean(),
  /** How many individual items the check covered. */
  items: z.number().int().nonnegative(),
  note: z.string().nullable().default(null),
});
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;

export const VerificationReportSchema = z.object({
  checkedAt: z.iso.datetime(),
  /** Repair rounds that were needed before this final verdict (0 = clean first time). */
  repairRounds: z.number().int().nonnegative(),
  checks: z.array(VerificationCheckSchema),
  /** Every defect found, with its final status (fixed / unresolved). */
  defects: z.array(DefectSchema),
  summary: z.object({
    errorsOpen: z.number().int().nonnegative(),
    warningsOpen: z.number().int().nonnegative(),
    fixed: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
  }),
});
export type VerificationReport = z.infer<typeof VerificationReportSchema>;

/* ---------------------------------------------------------------- forensic & skeptic findings */

export const FindingSchema = z.object({
  id: z.string(),
  agent: z.enum(["forensic", "skeptic"]),
  severity: z.enum(["high", "medium", "low"]),
  /** Short headline, e.g. "Receivables growing faster than revenue". */
  title: z.string(),
  /** 1–3 sentences. Every figure in it was computed by code or quoted verbatim from a filing. */
  detail: z.string(),
  /** Evidence ids (filing facts or quoted filing text) that support the finding. */
  evidenceIds: z.array(z.string()),
  /** The deterministic rule or check that raised it (forensic) or the assumption key it challenges (skeptic). */
  basis: z.string().nullable().default(null),
});
export type Finding = z.infer<typeof FindingSchema>;

/** A what-if valuation produced by re-running the deterministic model with different assumptions. */
export const ScenarioSchema = z.object({
  name: z.enum(["bear", "base", "bull"]),
  description: z.string(),
  /** Human-readable list of what changed vs the base case. */
  changes: z.array(z.string()),
  perShare: z.number(),
  enterpriseValue: z.number(),
  /** perShare / base perShare − 1. */
  deltaVsBase: z.number(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;
