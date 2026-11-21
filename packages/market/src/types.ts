import { type Evidence, EvidenceSchema } from "@dealpilot/shared";
import { z } from "zod";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Injected key/value cache. This package deliberately has no database dependency. */
export interface MarketCache {
  get(namespace: string, key: string): Promise<unknown | null>;
  set(namespace: string, key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

export const QuoteSchema = z.object({
  symbol: z.string(),
  /** Last price, in `currency` units. */
  price: z.number(),
  /** Market capitalisation in base currency units (not millions). */
  marketCap: z.number(),
  /** FMP's stable quote endpoint does not return share count; null unless supplied. */
  sharesOutstanding: z.number().nullable(),
  /** Null when FMP's quote payload omits it (use the profile for the currency). */
  currency: z.string().nullable(),
  asOf: z.iso.datetime(),
  evidence: EvidenceSchema,
});
export type Quote = z.infer<typeof QuoteSchema>;

export const ProfileSchema = z.object({
  symbol: z.string(),
  companyName: z.string(),
  beta: z.number().nullable(),
  sector: z.string().nullable(),
  industry: z.string().nullable(),
  exchange: z.string(),
  currency: z.string().nullable(),
  sharesOutstanding: z.number().nullable(),
  marketCap: z.number().nullable(),
  evidence: EvidenceSchema,
});
export type Profile = z.infer<typeof ProfileSchema>;

export const PeersSchema = z.object({
  symbol: z.string(),
  peers: z.array(z.string()),
  evidence: EvidenceSchema,
});
export type Peers = z.infer<typeof PeersSchema>;

export const RiskFreeRateSchema = z.object({
  /** Treasury curve date (YYYY-MM-DD). */
  date: z.iso.date(),
  /** 10-year par yield as a decimal (0.0425 = 4.25%). */
  tenYear: z.number(),
  sourceUrl: z.url(),
  evidence: EvidenceSchema,
});
export type RiskFreeRate = z.infer<typeof RiskFreeRateSchema>;

export function marketEvidence(args: {
  id: string;
  url: string;
  section: string;
  retrievedAt: string;
}): Evidence {
  return {
    id: args.id,
    kind: "market_data",
    accession: null,
    form: null,
    filed: null,
    url: args.url,
    section: args.section,
    quote: null,
    span: null,
    retrievedAt: args.retrievedAt,
  };
}
