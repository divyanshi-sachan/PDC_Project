import { describe, expect, test } from "vitest";
import { z } from "zod";
import { Budget } from "./budget.ts";
import { createLlmClient, extractJson, toParameters } from "./client.ts";
import { fakeLlm } from "./fake.ts";
import { BudgetExceededError, StructuredOutputError } from "./types.ts";

const Plan = z.object({ ticker: z.string(), horizon: z.number().int() });

/** Fake OpenAI-compatible chat completion response. */
function completion(opts: { toolArgs?: string; content?: string; cost?: number; model?: string }) {
  const body = {
    id: "x",
    object: "chat.completion",
    created: 0,
    model: opts.model ?? "claude-haiku-5-5",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: opts.content ?? null,
          tool_calls: opts.toolArgs
            ? [{ id: "c1", type: "function", function: { name: "make_plan", arguments: opts.toolArgs } }]
            : undefined,
        },
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "x-litellm-response-cost": String(opts.cost ?? 0.0021) },
  });
}

function scripted(responses: Response[], seen: unknown[] = []): typeof fetch {
  let i = 0;
  return async (_url, init) => {
    seen.push(JSON.parse(String(init?.body ?? "{}")));
    const r = responses[i++];
    if (!r) throw new Error("no more scripted responses");
    return r;
  };
}

const base = { baseUrl: "http://litellm.test", apiKey: "k" };
const req = {
  node: "orchestrator",
  group: "dp-producer" as const,
  system: "plan",
  messages: [{ role: "user" as const, content: "value AAPL" }],
  schema: Plan,
  schemaName: "make_plan",
};

describe("extractJson / toParameters", () => {
  test("handles fenced and chatty JSON", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":{"b":2}} hope that helps')).toEqual({ a: { b: 2 } });
    expect(() => extractJson("no json")).toThrow();
  });
  test("JSON schema has no $schema key and lists properties", () => {
    const p = toParameters(Plan);
    expect(p).not.toHaveProperty("$schema");
    expect(Object.keys(p.properties as object)).toEqual(["ticker", "horizon"]);
  });
});

describe("createLlmClient.structured", () => {
  test("forces the function call, parses args, reports usage and cost", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const budget = new Budget(1);
    const usages: unknown[] = [];
    const client = createLlmClient({
      ...base,
      budget,
      onUsage: (u) => void usages.push(u),
      fetch: scripted([completion({ toolArgs: '{"ticker":"AAPL","horizon":5}' })], seen),
    });
    const { data, usage } = await client.structured(req);
    expect(data).toEqual({ ticker: "AAPL", horizon: 5 });
    expect(usage[0]).toMatchObject({
      node: "orchestrator",
      inputTokens: 120,
      outputTokens: 30,
      costUsd: 0.0021,
    });
    expect(budget.spentUsd).toBeCloseTo(0.0021, 12);
    expect(usages).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      model: "dp-producer",
      tool_choice: { type: "function", function: { name: "make_plan" } },
    });
  });

  test("falls back to JSON in content when the model ignores tools", async () => {
    const client = createLlmClient({
      ...base,
      fetch: scripted([completion({ content: '```json\n{"ticker":"MSFT","horizon":3}\n```' })]),
    });
    expect((await client.structured(req)).data.ticker).toBe("MSFT");
  });

  test("retries once with the validation error, then succeeds", async () => {
    const seen: Array<{ messages: { role: string; content: string }[] }> = [];
    const client = createLlmClient({
      ...base,
      fetch: scripted(
        [
          completion({ toolArgs: '{"ticker":"AAPL","horizon":"five"}' }),
          completion({ toolArgs: '{"ticker":"AAPL","horizon":5}' }),
        ],
        seen,
      ),
    });
    const { data, usage } = await client.structured(req);
    expect(data.horizon).toBe(5);
    expect(usage).toHaveLength(2);
    const retryMsgs = seen[1]?.messages ?? [];
    expect(retryMsgs.at(-1)?.content).toMatch(/invalid/);
    expect(retryMsgs.at(-1)?.content).toMatch(/horizon/);
  });

  test("throws StructuredOutputError after retries are exhausted", async () => {
    const bad = () => completion({ toolArgs: '{"nope":1}' });
    const client = createLlmClient({ ...base, fetch: scripted([bad(), bad()]) });
    await expect(client.structured(req)).rejects.toBeInstanceOf(StructuredOutputError);
  });

  test("refuses to call once the budget is spent", async () => {
    const budget = new Budget(0.001);
    const client = createLlmClient({
      ...base,
      budget,
      fetch: scripted([completion({ toolArgs: '{"ticker":"A","horizon":1}', cost: 0.01 })]),
    });
    await client.structured(req); // spends 0.01 > 0.001
    await expect(client.structured(req)).rejects.toBeInstanceOf(BudgetExceededError);
  });
});

describe("fakeLlm", () => {
  test("validates structured output with the same schema", async () => {
    const { client, calls } = fakeLlm(() => ({ ticker: "AAPL", horizon: 5 }));
    expect((await client.structured(req)).data.horizon).toBe(5);
    expect(calls[0]?.node).toBe("orchestrator");
    const bad = fakeLlm(() => ({ ticker: 1 }));
    await expect(bad.client.structured(req)).rejects.toThrow();
  });
});
