import type { AnalysisSnapshot, ReviewOutput, Route } from "@dealpilot/agents";
import type { ChatTurnJob, Citation, Panel } from "@dealpilot/shared";
import { Annotation } from "@langchain/langgraph";

export interface TurnResult {
  text: string;
  citations: Citation[];
  panel: Panel | null;
}

export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
}

/**
 * Per-thread LangGraph state. `snapshot` survives across turns through the checkpointer, which is what makes
 * follow-ups ("use 9% WACC") a pure recompute. Everything else is reset at the start of each turn.
 */
export const TurnState = Annotation.Root({
  job: Annotation<ChatTurnJob>(),
  assistantMessageId: Annotation<string>(),
  history: Annotation<HistoryMessage[]>(),
  route: Annotation<Route | null>(),
  snapshot: Annotation<AnalysisSnapshot | null>(),
  /** Forensic + skeptic findings; persisted so follow-ups reuse them without re-reading filings. */
  review: Annotation<ReviewOutput | null>(),
  result: Annotation<TurnResult | null>(),
});

export type TurnStateType = typeof TurnState.State;
