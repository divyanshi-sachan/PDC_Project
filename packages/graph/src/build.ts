import {
  type AnalysisSnapshot,
  answerFromFilings,
  assemblePanel,
  buildSnapshot,
  type Candidate,
  composeMessage,
  computePanel,
  describeOverrides,
  formatAnalysisMessage,
  gatherHistory,
  indexLatestTenK,
  type MarketApi,
  type ModelingDeps,
  type RepairDeps,
  type ReviewOutput,
  recompute,
  routeMessage,
  runReview,
  UnsupportedCompanyError,
  ValuationError,
  verificationLine,
  verifyAndRepair,
  verifyFilingQuotes,
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
  /** Verifier loop settings; `inject` is a test hook that corrupts the candidate (error-injection tests). */
  repair?: Pick<RepairDeps, "inject" | "maxRepairs">;
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

  /** Attach the review, run the independent Verifier with its repair loop, and publish the final panel. */
  const finalize = async (
    snapshot: AnalysisSnapshot,
    review: ReviewOutput,
    commentary: string | null,
    changes: string[],
    narrative: boolean,
  ) => {
    const panel = assemblePanel(snapshot, review);
    const candidate: Candidate = {
      panel,
      commentary,
      changes,
      text: composeMessage(panel, changes, commentary),
    };
    const out = await step(
      "verifier",
      "Independently verifying figures, citations and consistency",
      () =>
        verifyAndRepair(
          {
            verifier: narrative ? { edgar: deps.edgar, llm: deps.llm } : {},
            refetchHistory: (t) => gatherHistory(deps.edgar, t),
            ...deps.repair,
            onRound: async ({ round, open, repairing }) => {
              await deps.emit({
                type: "step",
                stepId: `repair-${++stepCounter}`,
                node: "repair",
                status: "done",
                label: `Repair round ${round}: ${open.length} defect${open.length === 1 ? "" : "s"} sent back to ${repairing.join(", ")}`,
                detail: open
                  .map((d) => d.detail)
                  .join(" | ")
                  .slice(0, 300),
              });
            },
          },
          { snapshot, candidate, review },
        ),
      (r) => verificationLine(r.report),
    );
    await deps.emit({ type: "panel", panel: out.candidate.panel });
    const base = formatAnalysisMessage(out.candidate.panel, changes);
    return {
      snapshot: out.snapshot,
      review,
      result: {
        text: `${out.candidate.text}\n\n${verificationLine(out.report)}`,
        citations: base.citations,
        panel: out.candidate.panel,
      } satisfies TurnResult,
    };
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

      const review = await step(
        "review",
        "Forensic review and skeptic challenge",
        () => runReview({ llm: deps.llm, db: deps.db, embedder: deps.embedder }, snapshot),
        (r) => `${r.findings.length} findings`,
      );
      const commentary = await writeCommentary(deps.llm, panel);
      return await finalize(snapshot, review, commentary, [], true);
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
      return await finalize(
        out.snapshot,
        s.review ?? { findings: [], evidence: {} },
        null,
        describeOverrides(out.snapshot.overrides),
        false,
      );
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
      const quotes = await verifyFilingQuotes(deps.edgar, ans.evidence);
      const bad = quotes.defects.filter((d) => d.severity === "error");
      const text = bad.length
        ? `Verification failed: ${bad.length} quoted passage${bad.length === 1 ? "" : "s"} could not be found in the filing, so treat this answer as unverified.\n\n${ans.text}`
        : ans.text;
      return { result: { text, citations: ans.citations, panel: null } };
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
