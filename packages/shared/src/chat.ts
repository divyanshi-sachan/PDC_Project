import { z } from "zod";
import { EvidenceSchema } from "./facts.ts";

/* ------------------------------------------------------------------ assumptions */

/** Every number the model depends on is either from a filing, from market data, or an explicit assumption. */
export const AssumptionSchema = z.object({
  key: z.string(), // e.g. "wacc", "terminal_growth", "revenue_growth_y1"
  label: z.string(),
  value: z.number(),
  unit: z.enum(["pct", "usd", "multiple", "years", "shares", "ratio"]),
  source: z.enum(["filing", "market", "assumption"]),
  evidenceId: z.string().nullable(),
  rationale: z.string().nullable(),
});
export type Assumption = z.infer<typeof AssumptionSchema>;

/* ------------------------------------------------------------------ deliverable panel */

export const PeerRowSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  marketCap: z.number(),
  enterpriseValue: z.number(),
  evToRevenue: z.number().nullable(),
  evToEbitda: z.number().nullable(),
  priceToEarnings: z.number().nullable(),
  included: z.boolean(),
  excludedReason: z.string().nullable(),
  rationale: z.string().nullable(), // why this peer was chosen
});
export type PeerRow = z.infer<typeof PeerRowSchema>;

export const ProjectionRowSchema = z.object({
  year: z.number().int(),
  revenue: z.number(),
  ebit: z.number(),
  ufcf: z.number(),
  discountFactor: z.number(),
});

/**
 * Structured result shown in the right-hand panel. Every number here was computed
 * by `@dealpilot/finance`; `formulaIds` lists which functions produced them.
 */
export const PanelSchema = z.object({
  version: z.literal(1),
  ticker: z.string(),
  companyName: z.string(),
  cik: z.string(),
  asOf: z.iso.datetime(),
  currency: z.literal("USD"),
  price: z.number().nullable(),
  marketCap: z.number().nullable(),
  valuation: z.object({
    method: z.literal("dcf_gordon"),
    enterpriseValue: z.number(),
    equityValue: z.number(),
    perShare: z.number(),
    impliedUpsidePct: z.number().nullable(),
    terminalShareOfEv: z.number().nullable(),
    wacc: z.number(),
    terminalGrowth: z.number(),
  }),
  projection: z.array(ProjectionRowSchema),
  comps: z.object({
    peers: z.array(PeerRowSchema),
    medianEvToEbitda: z.number().nullable(),
    medianEvToRevenue: z.number().nullable(),
    impliedPerShare: z
      .object({ low: z.number(), median: z.number(), high: z.number(), basis: z.string() })
      .nullable(),
  }),
  sensitivity: z.object({
    title: z.string(),
    rowLabel: z.string(),
    colLabel: z.string(),
    rows: z.array(z.number()),
    cols: z.array(z.number()),
    values: z.array(z.array(z.number())),
  }),
  assumptions: z.array(AssumptionSchema),
  risks: z.array(z.object({ title: z.string(), detail: z.string(), evidenceIds: z.array(z.string()) })),
  evidence: z.record(z.string(), EvidenceSchema),
  formulaIds: z.array(z.string()),
});
export type Panel = z.infer<typeof PanelSchema>;

/* ------------------------------------------------------------------ chat events (SSE) */

export const CitationSchema = z.object({
  /** Key into `panel.evidence` / the evidence store. */
  evidenceId: z.string(),
  label: z.string(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const ChatEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("step"),
    stepId: z.string(),
    node: z.string(), // "orchestrator" | "research" | "modeling" | "verifier" | ...
    status: z.enum(["started", "done", "failed"]),
    label: z.string(),
    detail: z.string().nullable().default(null),
  }),
  z.object({
    type: z.literal("message"),
    messageId: z.string(),
    text: z.string(),
    citations: z.array(CitationSchema).default([]),
  }),
  z.object({ type: z.literal("panel"), panel: PanelSchema }),
  z.object({
    type: z.literal("cost"),
    costUsd: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
  }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
  z.object({ type: z.literal("done") }),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;

/* ------------------------------------------------------------------ jobs & API shapes */

/** Payload of the pg-boss "chat-turn" queue: one user message to process. */
export const ChatTurnJobSchema = z.object({
  threadId: z.uuid(),
  messageId: z.uuid(), // the user message
  assistantMessageId: z.uuid(), // the queued placeholder the worker fills in
  userId: z.string(), // Neon Auth user id
  text: z.string().min(1).max(4000),
});
export type ChatTurnJob = z.infer<typeof ChatTurnJobSchema>;

export const CHAT_TURN_QUEUE = "chat-turn";

export const PostMessageBodySchema = z.object({ text: z.string().trim().min(1).max(4000) });
export const CreateThreadBodySchema = z.object({ title: z.string().trim().min(1).max(120).optional() });

export const ThreadSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Thread = z.infer<typeof ThreadSchema>;

export const MessageSchema = z.object({
  id: z.uuid(),
  threadId: z.uuid(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  citations: z.array(CitationSchema),
  status: z.enum(["queued", "running", "done", "failed"]),
  createdAt: z.iso.datetime(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ApiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
