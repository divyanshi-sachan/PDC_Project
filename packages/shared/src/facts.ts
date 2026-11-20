import { z } from "zod";

/**
 * Where a piece of evidence came from. Every Fact and every narrative claim
 * must point at one of these — the Verifier resolves them independently.
 */
export const EvidenceSchema = z.object({
  id: z.string(),
  kind: z.enum(["xbrl_fact", "filing_text", "market_data", "web"]),
  /** SEC accession number, e.g. "0000320193-24-000123" (required for SEC kinds). */
  accession: z.string().nullable(),
  form: z.string().nullable(),
  filed: z.iso.date().nullable(),
  url: z.url().nullable(),
  /** 10-K Item ("7", "1A") or XBRL concept for xbrl_fact. */
  section: z.string().nullable(),
  /** Exact supporting quote (text evidence). */
  quote: z.string().nullable(),
  /** Character offsets of `quote` inside the section text, when known. */
  span: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).nullable(),
  retrievedAt: z.iso.datetime(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const PeriodSchema = z.object({
  /** Null for instant (balance-sheet) facts. */
  start: z.iso.date().nullable(),
  end: z.iso.date(),
  /** From SEC `fy`/`fp` of the first filing that reported the period; SEC sometimes omits them (null). */
  fiscalYear: z.number().int().nullable(),
  /** "FY", "Q1".."Q4", or "LTM" for derived trailing values. */
  fiscalPeriod: z.enum(["FY", "Q1", "Q2", "Q3", "Q4", "LTM"]).nullable(),
});
export type Period = z.infer<typeof PeriodSchema>;

/**
 * A reported (or derived) financial number in BASE units (e.g. USD, shares),
 * never "$mm". `scale` records the presentation scale of the source only.
 */
export const FactSchema = z.object({
  cik: z.string().regex(/^\d{10}$/),
  concept: z.string(), // e.g. "us-gaap:Revenues"
  label: z.string(),
  value: z.number().finite(),
  unit: z.string(), // "USD", "shares", "USD/shares", "pure"
  scale: z.number().int().default(0), // power of ten the source was presented in
  period: PeriodSchema,
  derived: z.boolean().default(false),
  /** For derived facts: ids of the facts they were computed from. */
  derivedFrom: z.array(z.string()).default([]),
  /** True when a later filing restated this period's value. */
  restated: z.boolean().default(false),
  evidence: EvidenceSchema,
});
export type Fact = z.infer<typeof FactSchema>;
