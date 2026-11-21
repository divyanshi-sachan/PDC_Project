import OpenAI from "openai";
import { z } from "zod";
import type { Budget } from "./budget.ts";
import {
  type LlmClient,
  type LlmUsage,
  StructuredOutputError,
  type StructuredRequest,
  type TextRequest,
} from "./types.ts";

export interface LlmClientOptions {
  /** LiteLLM proxy base URL, e.g. http://localhost:4001 */
  baseUrl: string;
  /** LiteLLM master key. */
  apiKey: string;
  budget?: Budget;
  /** Called after every attempt (trace events, cost events). */
  onUsage?: (u: LlmUsage) => void | Promise<void>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Strip a leading ```json fence and extract the first top-level JSON object. */
export function extractJson(text: string): unknown {
  const unfenced = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(unfenced.slice(start, end + 1));
}

/** Zod schema → JSON Schema for a function-call `parameters` field (no `$schema` key). */
export function toParameters(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _omit, ...rest } = z.toJSONSchema(schema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
  return rest;
}

export function createLlmClient(opts: LlmClientOptions): LlmClient {
  const openai = new OpenAI({
    baseURL: `${opts.baseUrl.replace(/\/$/, "")}/v1`,
    apiKey: opts.apiKey,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    timeout: opts.timeoutMs ?? 120_000,
    maxRetries: 0, // LiteLLM already retries / falls back across the group
  });

  async function call(
    base: { node: string; group: LlmUsage["group"]; attempt: number },
    params: Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "model">,
  ) {
    opts.budget?.check();
    const t0 = performance.now();
    const { data, response } = await openai.chat.completions
      .create({ ...params, model: base.group })
      .withResponse();
    const cost = Number(response.headers.get("x-litellm-response-cost") ?? 0);
    const usage: LlmUsage = {
      node: base.node,
      group: base.group,
      model: data.model,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      costUsd: Number.isFinite(cost) ? cost : 0,
      latencyMs: Math.round(performance.now() - t0),
      attempt: base.attempt,
    };
    opts.budget?.record(usage);
    await opts.onUsage?.(usage);
    return { data, usage };
  }

  return {
    async structured<T>(req: StructuredRequest<T>) {
      const maxRetries = req.maxRetries ?? 1;
      const usages: LlmUsage[] = [];
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: req.system },
        ...req.messages,
      ];
      let lastError = "no output";

      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        const { data, usage } = await call(
          { node: req.node, group: req.group, attempt },
          {
            messages,
            tools: [
              {
                type: "function",
                function: {
                  name: req.schemaName,
                  description: req.schemaDescription ?? `Return the ${req.schemaName} result.`,
                  parameters: toParameters(req.schema),
                },
              },
            ],
            tool_choice: { type: "function", function: { name: req.schemaName } },
            ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
            ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
          },
        );
        usages.push(usage);

        const msg = data.choices[0]?.message;
        const toolCall = msg?.tool_calls?.find((c) => c.type === "function");
        const raw =
          toolCall && toolCall.type === "function" ? toolCall.function.arguments : (msg?.content ?? "");
        try {
          const parsed =
            typeof raw === "string" && raw.trim().startsWith("{") ? JSON.parse(raw) : extractJson(raw);
          const checked = req.schema.safeParse(parsed);
          if (checked.success) return { data: checked.data, usage: usages };
          lastError = z.prettifyError(checked.error);
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
        // Retry once with the validation error appended.
        messages.push(
          { role: "assistant", content: typeof raw === "string" ? raw.slice(0, 4000) : "" },
          {
            role: "user",
            content: `Your previous output was invalid:\n${lastError}\nCall ${req.schemaName} again with corrected arguments.`,
          },
        );
      }
      throw new StructuredOutputError(req.node, maxRetries + 1, lastError);
    },

    async text(req: TextRequest) {
      const { data, usage } = await call(
        { node: req.node, group: req.group, attempt: 1 },
        {
          messages: [{ role: "system", content: req.system }, ...req.messages],
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
        },
      );
      return { text: data.choices[0]?.message?.content ?? "", usage };
    },
  };
}
