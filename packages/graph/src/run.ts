import type { ChatEvent, ChatTurnJob } from "@dealpilot/shared";
import type { DealPilotGraph } from "./build.ts";
import type { HistoryMessage, TurnResult } from "./state.ts";

export interface ChatTurnInput {
  job: ChatTurnJob;
  /** Id of the assistant placeholder message the final `message` event refers to. */
  assistantMessageId: string;
  /** Recent messages in the thread, oldest first (excluding the new one). */
  history: HistoryMessage[];
}

/**
 * Run one chat turn. State for the thread (notably the analysis snapshot) is restored from the checkpointer
 * by `thread_id`, so a follow-up message can recompute without re-reading any filing.
 * On an unexpected error an `error` event is emitted and the error is rethrown so the worker can mark the
 * message failed.
 */
export async function runChatTurn(
  graph: DealPilotGraph,
  input: ChatTurnInput,
  emit: (e: ChatEvent) => Promise<void>,
): Promise<TurnResult> {
  try {
    const out = await graph.invoke(
      {
        job: input.job,
        assistantMessageId: input.assistantMessageId,
        history: input.history,
        route: null,
        result: null,
      },
      { configurable: { thread_id: input.job.threadId } },
    );
    return out.result ?? { text: "", citations: [], panel: null };
  } catch (e) {
    await emit({
      type: "error",
      code: "turn_failed",
      message: e instanceof Error ? e.message.slice(0, 300) : "Unexpected error",
    });
    await emit({ type: "done" });
    throw e;
  }
}
