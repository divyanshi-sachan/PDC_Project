import type { LlmClient } from "@dealpilot/llm";
import { z } from "zod";
import { NO_OVERRIDES, type Overrides, OverridesSchema } from "./modeling/overrides.ts";
import { loadPrompt } from "./prompts.ts";

/** Flat on purpose: nested unions are poorly supported by some providers' function-calling schemas. */
const RouteOutputSchema = z.object({
  type: z.enum(["analysis", "recompute", "evidence_question", "other"]),
  ticker: z
    .string()
    .nullable()
    .describe("US ticker, upper case. For analysis/evidence_question about a company."),
  price: z
    .number()
    .positive()
    .max(100_000)
    .nullable()
    .default(null)
    .describe("For analysis only: a share price in USD if the user states one (e.g. 'price is $38')."),
  changes: OverridesSchema.nullable().describe("For recompute only: what the user wants changed."),
  question: z.string().nullable().describe("For evidence_question: the question restated."),
  reply: z.string().max(500).nullable().describe("For other: a short helpful reply with no figures."),
});

export type Route =
  | { type: "analysis"; ticker: string; price: number | null }
  | { type: "recompute"; changes: Overrides }
  | { type: "evidence_question"; ticker: string | null; question: string }
  | { type: "other"; reply: string };

const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;

export interface RouteContext {
  llm: LlmClient;
  message: string;
  history: { role: "user" | "assistant"; text: string }[];
  /** Ticker of the analysis stored for this thread, if any. */
  activeTicker: string | null;
}

/** Classify a chat message. Falls back to a gentle clarification when the model output is unusable. */
export async function routeMessage(ctx: RouteContext): Promise<Route> {
  const recent = ctx.history
    .slice(-6)
    .map((m) => `${m.role}: ${m.text.slice(0, 300)}`)
    .join("\n");
  const { data } = await ctx.llm.structured({
    node: "orchestrator.route",
    group: "dp-producer",
    system: loadPrompt("route.v1"),
    messages: [
      {
        role: "user",
        content: [
          `Active analysis in this thread: ${ctx.activeTicker ?? "none"}`,
          recent ? `Recent messages:\n${recent}` : "Recent messages: none",
          `New user message: ${ctx.message}`,
        ].join("\n"),
      },
    ],
    schema: RouteOutputSchema,
    schemaName: "route_message",
    schemaDescription: "Classify the user's message.",
    maxTokens: 400,
    temperature: 0,
  });

  const ticker = data.ticker?.trim().toUpperCase() ?? null;
  const validTicker = ticker !== null && TICKER.test(ticker) ? ticker : null;

  if (data.type === "analysis" && validTicker)
    return { type: "analysis", ticker: validTicker, price: data.price };
  if (data.type === "recompute") {
    if (!ctx.activeTicker) {
      return {
        type: "other",
        reply:
          "There's no valuation in this chat yet. Tell me which company to value, for example “Value Apple with a DCF and comps”.",
      };
    }
    return { type: "recompute", changes: data.changes ?? NO_OVERRIDES };
  }
  if (data.type === "evidence_question") {
    const t = validTicker ?? ctx.activeTicker;
    if (t) return { type: "evidence_question", ticker: t, question: data.question ?? ctx.message };
  }
  return {
    type: "other",
    reply:
      data.reply ??
      "I can value a US public company (DCF and trading comps) or answer questions about its latest 10-K. Which company are you interested in?",
  };
}
