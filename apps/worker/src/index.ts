/**
 * DealPilot worker: consumes `chat-turn` jobs from pg-boss, runs the LangGraph graph for the thread,
 * streams ChatEvents into `thread_events` (the API replays them over SSE), and records messages, tasks,
 * cost and an audit trail in Postgres.
 *   pnpm --filter @dealpilot/worker start
 */
import {
  appendThreadEvent,
  createDb,
  directDatabaseUrl,
  eq,
  messages,
  pooledDatabaseUrl,
  sql,
  tasks,
  threads,
  traceEvents,
} from "@dealpilot/db";
import { buildGraph, createRuntime, runChatTurn } from "@dealpilot/graph";
import { Budget, type LlmUsage } from "@dealpilot/llm";
import { CHAT_TURN_QUEUE, type ChatEvent, ChatTurnJobSchema } from "@dealpilot/shared";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { config } from "dotenv";
import { PgBoss } from "pg-boss";

config({ path: [".env.local", ".env"], quiet: true });

const runtime = createRuntime(process.env);
const { db, close: closeDb } = createDb(pooledDatabaseUrl(), { max: 4 });

// pg-boss and the LangGraph checkpointer need session features → direct (non-pooled) connection.
const direct = directDatabaseUrl();
const checkpointer = PostgresSaver.fromConnString(direct, { schema: "langgraph" });
await checkpointer.setup();

const boss = new PgBoss({ connectionString: direct, max: 4 });
boss.on("error", (e) => console.error("[worker] pg-boss error:", e.message));
await boss.start();
await boss.createQueue(CHAT_TURN_QUEUE, { retryLimit: 0, expireInSeconds: 900 });

async function processTurn(raw: unknown): Promise<void> {
  const parsed = ChatTurnJobSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("[worker] dropping malformed job:", parsed.error.message.slice(0, 200));
    return;
  }
  const job = parsed.data;
  const { assistantMessageId, threadId } = job;
  const started = Date.now();

  await db.update(messages).set({ status: "running" }).where(eq(messages.id, assistantMessageId));
  const [task] = await db
    .insert(tasks)
    .values({ ticker: "", request: { text: job.text, threadId }, status: "running" })
    .returning({ id: tasks.id });
  const taskId = task?.id as string;
  await db.update(messages).set({ taskId }).where(eq(messages.id, assistantMessageId));

  // Recent conversation (oldest first), excluding this turn's two messages.
  const prior = await db
    .select({ role: messages.role, text: messages.text, status: messages.status, id: messages.id })
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(messages.createdAt);
  const history = prior
    .filter((m) => m.status === "done" && m.text && m.id !== job.messageId && m.id !== assistantMessageId)
    .slice(-8)
    .map((m) => ({ role: m.role, text: m.text }));

  const emit = async (event: ChatEvent) => {
    await appendThreadEvent(db, { threadId, messageId: assistantMessageId, event });
  };
  const budget = new Budget(runtime.maxCostUsd);
  const onUsage = async (u: LlmUsage) => {
    await db.insert(traceEvents).values({
      taskId,
      node: u.node,
      kind: "llm_call",
      payload: { group: u.group, attempt: u.attempt },
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      costUsd: u.costUsd,
      latencyMs: u.latencyMs,
    });
  };
  const graph = buildGraph(
    {
      llm: runtime.llmFor(budget, onUsage),
      db,
      emit,
      budget,
      edgar: runtime.edgar,
      market: runtime.market,
      embedder: runtime.embedder,
    },
    checkpointer,
  );

  try {
    const result = await runChatTurn(graph, { job, assistantMessageId, history }, emit);
    await db
      .update(messages)
      .set({ text: result.text, citations: result.citations, status: "done" })
      .where(eq(messages.id, assistantMessageId));
    await db
      .update(tasks)
      .set({
        status: "succeeded",
        ticker: result.panel?.ticker ?? "",
        costUsd: budget.spentUsd,
        finishedAt: sql`now()`,
      })
      .where(eq(tasks.id, taskId));
    console.error(
      `[worker] turn done in ${((Date.now() - started) / 1000).toFixed(1)}s, $${budget.spentUsd.toFixed(4)}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[worker] turn failed:", msg.slice(0, 300));
    await db
      .update(messages)
      .set({ text: "Sorry, something went wrong while working on that. Please try again.", status: "failed" })
      .where(eq(messages.id, assistantMessageId));
    await db
      .update(tasks)
      .set({ status: "failed", error: msg.slice(0, 500), costUsd: budget.spentUsd, finishedAt: sql`now()` })
      .where(eq(tasks.id, taskId));
  } finally {
    await db.update(threads).set({ updatedAt: sql`now()` }).where(eq(threads.id, threadId));
  }
}

await boss.work(CHAT_TURN_QUEUE, { localConcurrency: 2 }, async (jobs) => {
  for (const j of jobs) await processTurn(j.data);
});
console.error("[worker] ready: consuming", CHAT_TURN_QUEUE);

const shutdown = async () => {
  await Promise.allSettled([boss.stop({ graceful: true, timeout: 20_000 }), checkpointer.end(), closeDb()]);
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
