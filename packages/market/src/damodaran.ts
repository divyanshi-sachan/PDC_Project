import { readFileSync } from "node:fs";
import type { Evidence } from "@dealpilot/shared";
import { z } from "zod";
import { marketEvidence } from "./types.ts";

const IndustrySchema = z.object({
  name: z.string(),
  firms: z.number().int().positive(),
  beta: z.number(),
  debtToEquity: z.number(),
  effectiveTaxRate: z.number().nullable(),
  unleveredBeta: z.number(),
  /** Unlevered beta corrected for cash: the pure-play operating beta to relever. */
  unleveredBetaCorrectedForCash: z.number(),
});
export type DamodaranIndustry = z.infer<typeof IndustrySchema>;

const SnapshotSchema = z.object({
  source: z.url(),
  dataset: z.string(),
  updated: z.iso.date(),
  note: z.string(),
  industries: z.array(IndustrySchema).min(50),
});

export interface IndustryBetaTable {
  /** Date of Damodaran's data (ISO). */
  updated: string;
  source: string;
  industries: DamodaranIndustry[];
  names(): string[];
  find(name: string): DamodaranIndustry | undefined;
  /** Citation for any figure taken from this table. */
  evidence(retrievedAt: string): Evidence;
}

/** Build a table from parsed snapshot data (exported for tests with small tables). */
export function industryBetaTable(raw: unknown): IndustryBetaTable {
  const snap = SnapshotSchema.parse(raw);
  const byName = new Map(snap.industries.map((i) => [i.name.toLowerCase(), i]));
  return {
    updated: snap.updated,
    source: snap.source,
    industries: snap.industries,
    names: () => snap.industries.map((i) => i.name),
    find: (name) => byName.get(name.trim().toLowerCase()),
    evidence: (retrievedAt) =>
      marketEvidence({
        id: `market:damodaran:industry-betas:${snap.updated}`,
        url: snap.source,
        section: "damodaran:industry-betas",
        retrievedAt,
      }),
  };
}

let cached: IndustryBetaTable | undefined;

/**
 * Damodaran's US industry betas as of the committed snapshot (`data/damodaran-betas-us.json`, regenerated each
 * January with `scripts/damodaran/convert.py`). These are INDUSTRY betas: label them so wherever they are shown.
 */
export function loadDamodaranBetas(): IndustryBetaTable {
  if (!cached) {
    const file = new URL("../data/damodaran-betas-us.json", import.meta.url);
    cached = industryBetaTable(JSON.parse(readFileSync(file, "utf8")));
  }
  return cached;
}
