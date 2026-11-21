import type {
  LlmClient,
  LlmUsage,
  StructuredRequest,
  StructuredResult,
  TextRequest,
  TextResult,
} from "./types.ts";

export interface FakeCall {
  node: string;
  group: string;
  system: string;
  user: string;
  schemaName?: string;
}

/**
 * Offline LlmClient for tests. `respond(call)` returns the object (for structured) or
 * string (for text) the "model" should produce. Structured output is still validated by
 * the request's Zod schema, exactly like the real client.
 */
export function fakeLlm(respond: (call: FakeCall) => unknown) {
  const calls: FakeCall[] = [];
  const usage = (req: { node: string; group: LlmUsage["group"] }): LlmUsage => ({
    node: req.node,
    group: req.group,
    model: "fake",
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0,
    latencyMs: 1,
    attempt: 1,
  });

  const client: LlmClient = {
    async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const call: FakeCall = {
        node: req.node,
        group: req.group,
        system: req.system,
        user: req.messages.map((m) => m.content).join("\n"),
        schemaName: req.schemaName,
      };
      calls.push(call);
      return { data: req.schema.parse(respond(call)), usage: [usage(req)] };
    },
    async text(req: TextRequest): Promise<TextResult> {
      const call: FakeCall = {
        node: req.node,
        group: req.group,
        system: req.system,
        user: req.messages.map((m) => m.content).join("\n"),
      };
      calls.push(call);
      return { text: String(respond(call)), usage: usage(req) };
    },
  };
  return { client, calls };
}
