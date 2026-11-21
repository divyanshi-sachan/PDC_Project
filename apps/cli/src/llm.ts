/**
 * `pnpm cli llm smoke` — one structured call per model group through the LiteLLM proxy.
 * Shows which concrete model answered, tokens and cost. Costs a few cents at most.
 */
import { createLlmClient, type ModelGroup } from "@dealpilot/llm";
import { z } from "zod";

const Intent = z.object({
  ticker: z.string().describe("US stock ticker symbol, upper case"),
  intent: z.enum(["analysis", "recompute", "evidence_question", "other"]),
});

export async function llmSmoke(groups: ModelGroup[] = ["dp-producer", "dp-producer-paid", "dp-verifier"]) {
  const baseUrl = process.env.LITELLM_BASE_URL ?? "http://localhost:4001";
  const apiKey = process.env.LITELLM_MASTER_KEY;
  if (!apiKey) throw new Error("LITELLM_MASTER_KEY missing in .env");
  const llm = createLlmClient({ baseUrl, apiKey });

  let failed = 0;
  for (const group of groups) {
    try {
      const { data, usage } = await llm.structured({
        node: "smoke",
        group,
        system: "Classify the user's request. Reply only by calling the function.",
        messages: [{ role: "user", content: "Value Apple with a DCF and comps" }],
        schema: Intent,
        schemaName: "classify_request",
        maxTokens: 200,
      });
      const u = usage.at(-1);
      console.log(
        `✓ ${group.padEnd(17)} → ${u?.model} | ${JSON.stringify(data)} | ${u?.inputTokens}in/${u?.outputTokens}out | $${(u?.costUsd ?? 0).toFixed(5)} | ${u?.latencyMs}ms | attempts ${usage.length}`,
      );
    } catch (e) {
      failed++;
      console.log(`✗ ${group.padEnd(17)} → ${e instanceof Error ? e.message.slice(0, 300) : e}`);
    }
  }
  if (failed) process.exitCode = 1;
}
