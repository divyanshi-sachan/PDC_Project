import {
  answerFromFilings,
  buildSnapshot,
  computePanel,
  describeOverrides,
  formatAnalysisMessage,
  gatherHistory,
  indexLatestTenK,
  type MarketApi,
  type ModelingDeps,
  recompute,
  routeMessage,
  UnsupportedCompanyError,
  ValuationError,
  writeCommentary,
} from "@dealpilot/agents";
import { chunks, type Db, eq, sql } from "@dealpilot/db";
import type { Budget } from "@dealpilot/llm";
import { MarketDataError, PriceUnavailableError } from "@dealpilot/market";
import type { ChatEvent } from "@dealpilot/shared";
import { EdgarServiceError, type Embedder } from "@dealpilot/sources";
import { type BaseCheckpointSaver, END, START, StateGraph } from "@langchain/langgraph";
import { type TurnResult, TurnState, type TurnStateType } from "./state.ts";

export interface GraphDeps extends Omit<ModelingDeps, "progress"> {
  db: Db;
  embedder: Embedder;
  /** Persist + publish a chat event (worker: `thread_events` row). */
  emit: (event: ChatEvent) => Promise<void>;
  budget?: Budget;
  market: MarketApi;
}

/** User-facing explanation for expected failures; unexpected errors are rethrown. */
export function explainError(e: unknown, subject: string): string | null {
  if (e instanceof UnsupportedCompanyError || e instanceof ValuationError)
    return `I couldn't value ${subject}: ${e.message}`;
  if (e instanceof EdgarServiceError) {
    return e.status === 404
      ? `I couldn't find “${subject}” in SEC filings. Please check the ticker (US-listed companies only).`
      : `The SEC data service had a problem (${e.code}). Please try again in a moment.`;
  }
  if (e instanceof PriceUnavailableError) {
    return `I couldn't get a share price for ${subject} from the configured price sources. If you tell me the price, I can continue, for example: “Value ${subject}, the price is $100”.`;
  }
  if (e instanceof MarketDataError) {
    return e.code === "plan_limited" || e.code === "not_found"
      ? `I couldn't get market data for “${subject}”. It may not be a supported US ticker.`
      : `The market data provider had a problem (${e.code}). Please try again in a moment.`;
  }
  return null;
}

let stepCounter = 0;

export function buildGraph(deps: GraphDeps, checkpointer: BaseCheckpointSaver) {
  const step = async <T>(
    node: string,
    label: string,
    fn: () => Promise<T>,
    detail?: (r: T) => string | null,
  ): Promise<T> => {
    const stepId = `${node}-${++stepCounter}`;
    await deps.emit({ type: "step", stepId, node, status: "started", label, detail: null });
    try {
      const r = await fn();
      await deps.emit({ type: "step", stepId, node, status: "done", label, detail: detail?.(r) ?? null });
      return r;
    } catch (e) {
      await deps.emit({
        type: "step",
        stepId,
        node,
        status: "failed",
        label,
        detail: e instanceof Error ? e.message.slice(0, 200) : null,
      });
      throw e;
    }
  };

  const progress: ModelingDeps["progress"] = async (label, detail) => {
    await deps.emit({
      type: "step",
      stepId: `modeling-${++stepCounter}`,
      node: "modeling",
      status: "done",
      label,
      detail: detail ?? null,
    });
  };
  const modelingDeps: ModelingDeps = { ...deps, progress };

  const hasChunks = async (accessionCik: string) => {
    const r = await deps.db
      .select({ n: sql<number>`count(*)::int` })
      .from(chunks)
      .where(eq(chunks.cik, accessionCik));
    return (r[0]?.n ?? 0) > 0;
  };

  /* ------------------------------------------------------------------ nodes */

  const route = async (s: TurnStateType) => {
    const r = await step(
      "orchestrator",
      "Understanding your request",
      () =>
        routeMessage({
          llm: deps.llm,
          message: s.job.text,
          history: s.history ?? [],
          activeTicker: s.snapshot?.ticker ?? null,
        }),
      (x) =>
        x.type === "analysis"
          ? `Valuation of ${x.ticker}`
          : x.type === "recompute"
            ? "Recompute with your changes"
            : x.type === "evidence_question"
              ? "Question about the filing"
              : null,
    );
    return { route: r };
  };

  const analysis = async (s: TurnStateType) => {
    const route = s.route as { ticker: string; price?: number | null };
    const ticker = route.ticker;
    const userPrice = route.price ?? undefined;
    try {
      const history = await step(
        "research",
        `Reading ${ticker} filings from SEC EDGAR`,
        () => gatherHistory(deps.edgar, ticker),
        (h) => {
          const n = Object.values(h.items).reduce((a, f) => a + (f?.length ?? 0), 0);
          return `${n} cited facts from ${h.company.name}, latest fiscal year ended ${h.latestFiscalYearEnd}`;
        },
      );
      // Index the 10-K for later evidence questions in the background of modeling (non-fatal).
      const indexing = indexLatestTenK(
        { edgar: deps.edgar, db: deps.db, embedder: deps.embedder },
        ticker,
      ).catch(() => null);

      const snapshot = await step(
        "modeling",
        "Building assumptions, peers and market inputs",
        () => buildSnapshot(modelingDeps, ticker, history, userPrice === undefined ? {} : { userPrice }),
        (x) => `${x.peers.length} comparable companies`,
      );
      const panel = await step(
        "modeling",
        "Running DCF and comps with the finance library",
        async () => computePanel(snapshot),
        (p) => `${p.formulaIds.length} deterministic formulas`,
      );
      await deps.emit({ type: "panel", panel });
      await indexing;

      const base = formatAnalysisMessage(panel);
      const commentary = await writeCommentary(deps.llm, panel);
      const result: TurnResult = {
        text: commentary ? `${base.text}\n\n${commentary}` : base.text,
        citations: base.citations,
        panel,
      };
      return { snapshot, result };
    } catch (e) {
      const msg = explainError(e, ticker);
      if (!msg) throw e;
      return { result: { text: msg, citations: [], panel: null } };
    }
  };

  const recomputeNode = async (s: TurnStateType) => {
    const snapshot = s.snapshot;
    if (!snapshot || s.route?.type !== "recompute")
      return { result: { text: "There's no valuation in this chat yet.", citations: [], panel: null } };
    const changes = s.route.changes;
    try {
      const out = await step(
        "modeling",
        "Recomputing with the finance library (no filings re-read)",
        async () => recompute(snapshot, changes),
      );
      await deps.emit({ type: "panel", panel: out.panel });
      const base = formatAnalysisMessage(out.panel, describeOverrides(out.snapshot.overrides));
      return {
        snapshot: out.snapshot,
        result: { text: base.text, citations: base.citations, panel: out.panel },
      };
    } catch (e) {
      const msg = explainError(e, snapshot.ticker);
      if (!msg) throw e;
      return { result: { text: msg, citations: [], panel: null } };
    }
  };

  const evidence = async (s: TurnStateType) => {
    const r = s.route;
    if (r?.type !== "evidence_question" || !r.ticker)
      return { result: { text: "Which company's filing should I look at?", citations: [], panel: null } };
    const ticker = r.ticker;
    try {
      const company =
        s.snapshot && s.snapshot.ticker === ticker
          ? { cik: s.snapshot.cik, name: s.snapshot.companyName }
          : await deps.edgar.company(ticker).then((c) => ({ cik: c.cik, name: c.name }));
      if (!(await hasChunks(company.cik))) {
        await step(
          "research",
          `Indexing the latest ${ticker} 10-K`,
          () => indexLatestTenK({ edgar: deps.edgar, db: deps.db, embedder: deps.embedder }, ticker),
          (x) => `${x.chunks} passages`,
        );
      }
      const ans = await step("research", "Searching the 10-K and checking quotes", () =>
        answerFromFilings(
          { llm: deps.llm, db: deps.db, embedder: deps.embedder },
          { cik: company.cik, companyName: company.name, question: r.question },
        ),
      );
      return { result: { text: ans.text, citations: ans.citations, panel: null } };
    } catch (e) {
      const msg = explainError(e, ticker);
      if (!msg) throw e;
      return { result: { text: msg, citations: [], panel: null } };
    }
  };

  const other = async (s: TurnStateType) => ({
    result: {
      text: s.route?.type === "other" ? s.route.reply : "How can I help?",
      citations: [],
      panel: null,
    } satisfies TurnResult,
  });

  const finish = async (s: TurnStateType) => {
    const res = s.result ?? { text: "Done.", citations: [], panel: null };
    await deps.emit({
      type: "message",
      messageId: s.assistantMessageId,
      text: res.text,
      citations: res.citations,
    });
    if (deps.budget) {
      await deps.emit({
        type: "cost",
        costUsd: deps.budget.spentUsd,
        inputTokens: deps.budget.inputTokens,
        outputTokens: deps.budget.outputTokens,
      });
    }
    await deps.emit({ type: "done" });
    return {};
  };

  return new StateGraph(TurnState)
    .addNode("classify", route)
    .addNode("analysis", analysis)
    .addNode("recompute", recomputeNode)
    .addNode("evidence", evidence)
    .addNode("other", other)
    .addNode("finish", finish)
    .addEdge(START, "classify")
    .addConditionalEdges("classify", (s: TurnStateType) => s.route?.type ?? "other", {
      analysis: "analysis",
      recompute: "recompute",
      evidence_question: "evidence",
      other: "other",
    })
    .addEdge("analysis", "finish")
    .addEdge("recompute", "finish")
    .addEdge("evidence", "finish")
    .addEdge("other", "finish")
    .addEdge("finish", END)
    .compile({ checkpointer });
}

export type DealPilotGraph = ReturnType<typeof buildGraph>;
