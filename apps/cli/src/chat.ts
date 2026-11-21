/**
 * `pnpm cli chat "<msg>" ["<msg2>" ...]` — run chat turns locally against the REAL services
 * (edgar-service, LiteLLM, FMP, Neon) in one thread, printing the event stream the web app would receive.
 * Run against a dev branch: node scripts/with-neon-branch.mjs m2-dev -- pnpm cli chat "Value Apple"
 */
import { randomUUID } from "node:crypto";
import { createDb } from "@dealpilot/db";
import { buildGraph, runChatTurn } from "@dealpilot/graph";
import { Budget, createLlmClient } from "@dealpilot/llm";
import { createMarketClient } from "@dealpilot/market";
import type { ChatEvent, Panel } from "@dealpilot/shared";
import { createEdgarClient, openAiCompatibleEmbedder } from "@dealpilot/sources";
import { MemorySaver } from "@langchain/langgraph";

const usd = (x: number) => (Math.abs(x) >= 1e9 ? `$${(x / 1e9).toFixed(1)}B` : `$${(x / 1e6).toFixed(0)}M`);

function printPanel(p: Panel) {
  const v = p.valuation;
  console.log(
    `  ┌ PANEL ${p.ticker}  DCF $${v.perShare.toFixed(2)}/sh  EV ${usd(v.enterpriseValue)}  WACC ${(v.wacc * 100).toFixed(2)}%  g ${(v.terminalGrowth * 100).toFixed(1)}%  TV share ${v.terminalShareOfEv === null ? "n/a" : `${(v.terminalShareOfEv * 100).toFixed(0)}%`}`,
  );
  console.log(
    `  │ price ${p.price} | upside ${v.impliedUpsidePct === null ? "n/a" : `${(v.impliedUpsidePct * 100).toFixed(1)}%`}`,
  );
  console.log(
    `  │ projection: ${p.projection.map((r) => `${r.year}: rev ${usd(r.revenue)} fcf ${usd(r.ufcf)}`).join(" | ")}`,
  );
  const c = p.comps;
  console.log(
    `  │ comps: ${c.peers.map((r) => `${r.ticker}${r.included ? "" : "(x)"} ${r.evToEbitda?.toFixed(1) ?? "n/a"}x`).join(", ")} | median EV/EBITDA ${c.medianEvToEbitda?.toFixed(1) ?? "n/a"} | implied ${c.impliedPerShare ? `$${c.impliedPerShare.low.toFixed(0)}–$${c.impliedPerShare.high.toFixed(0)} (median $${c.impliedPerShare.median.toFixed(0)})` : "n/a"}`,
  );
  console.log(`  │ sensitivity (rows WACC, cols g):`);
  console.log(`  │        ${p.sensitivity.cols.map((g) => `${(g * 100).toFixed(1)}%`.padStart(8)).join("")}`);
  for (const [r, w] of p.sensitivity.rows.entries()) {
    const cells = (p.sensitivity.values[r] ?? []).map((x) => `${x.toFixed(0)}`.padStart(8)).join("");
    console.log(`  │ ${(w * 100).toFixed(2)}% ${cells}`);
  }
  console.log(`  │ notes: ${p.risks.map((r) => r.title).join("; ") || "none"}`);
  console.log(
    `  └ ${p.assumptions.length} assumptions, ${Object.keys(p.evidence).length} evidence items, formulas: ${p.formulaIds.join(", ")}`,
  );
}

export async function chatLocal(messages: string[]) {
  const e = process.env;
  const need = ["DATABASE_URL", "LITELLM_MASTER_KEY", "FMP_API_KEY"] as const;
  for (const k of need) if (!e[k]) throw new Error(`${k} missing in .env`);

  const budget = new Budget(Number(e.MAX_COST_PER_TASK_USD ?? 0.5));
  const calls: string[] = [];
  const baseUrl = e.LITELLM_BASE_URL ?? "http://localhost:4001";
  const llm = createLlmClient({
    baseUrl,
    apiKey: e.LITELLM_MASTER_KEY as string,
    budget,
    onUsage: (u) =>
      void calls.push(
        `${u.node}→${u.group} ${u.inputTokens}in/${u.outputTokens}out $${u.costUsd.toFixed(5)} ${u.latencyMs}ms${u.attempt > 1 ? ` (attempt ${u.attempt})` : ""}`,
      ),
  });
  const { db, close } = createDb(e.DATABASE_URL as string, { max: 3 });
  const emit = async (ev: ChatEvent) => {
    if (ev.type === "step")
      console.log(
        `  ${ev.status === "started" ? "▸" : ev.status === "done" ? "✓" : "✗"} [${ev.node}] ${ev.label}${ev.detail ? ` — ${ev.detail}` : ""}`,
      );
    else if (ev.type === "panel") printPanel(ev.panel);
    else if (ev.type === "message")
      console.log(
        `\n  ASSISTANT:\n${ev.text
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n")}\n  citations: ${ev.citations.map((c) => c.label).join("; ") || "none"}`,
      );
    else if (ev.type === "cost")
      console.log(
        `  💲 total so far $${ev.costUsd.toFixed(4)} (${ev.inputTokens} in / ${ev.outputTokens} out tokens)`,
      );
    else if (ev.type === "error") console.log(`  ✗ ERROR ${ev.code}: ${ev.message}`);
  };
  const graph = buildGraph(
    {
      llm,
      db,
      emit,
      budget,
      edgar: createEdgarClient({
        baseUrl: e.EDGAR_SERVICE_URL ?? "http://localhost:8100",
        ...(e.EDGAR_SERVICE_KEY ? { serviceKey: e.EDGAR_SERVICE_KEY } : {}),
      }),
      market: createMarketClient({ fmpApiKey: e.FMP_API_KEY as string }),
      embedder: openAiCompatibleEmbedder({
        baseUrl,
        apiKey: e.LITELLM_MASTER_KEY as string,
        model: "dp-embed",
      }),
    },
    new MemorySaver(),
  );

  const threadId = randomUUID();
  const history: { role: "user" | "assistant"; text: string }[] = [];
  try {
    for (const text of messages) {
      console.log(`\n━━ USER: ${text}`);
      const t0 = Date.now();
      const assistantMessageId = randomUUID();
      const res = await runChatTurn(
        graph,
        {
          job: { threadId, messageId: randomUUID(), assistantMessageId, userId: "local-cli", text },
          assistantMessageId,
          history,
        },
        emit,
      );
      history.push({ role: "user", text }, { role: "assistant", text: res.text });
      console.log(`  ⏱ ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
    console.log(`\nLLM calls (${calls.length}):\n${calls.map((c) => `  · ${c}`).join("\n")}`);
  } finally {
    await close();
  }
}
