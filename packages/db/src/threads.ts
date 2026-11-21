import { and, asc, eq, gt, sql } from "drizzle-orm";
import postgres from "postgres";
import type { Db } from "./client.ts";
import { threadEvents } from "./schema.ts";

/** Postgres NOTIFY channel signalled (payload = threadId) after every `appendThreadEvent`. */
export const THREAD_EVENTS_CHANNEL = "thread_events";

export interface ThreadEventRow {
  id: number;
  threadId: string;
  messageId: string | null;
  /** A ChatEvent (validated by the reader, not by this package). */
  event: unknown;
}

/** Append one ChatEvent to the thread log and NOTIFY listeners. Returns the new row id. */
export async function appendThreadEvent(
  db: Db,
  input: { threadId: string; messageId?: string | null; event: unknown },
): Promise<number> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(threadEvents)
      .values({ threadId: input.threadId, messageId: input.messageId ?? null, event: input.event })
      .returning({ id: threadEvents.id });
    if (!row) throw new Error("thread event insert returned no row");
    // NOTIFY is delivered on commit, so listeners never see an id they cannot yet SELECT.
    await tx.execute(sql`select pg_notify(${THREAD_EVENTS_CHANNEL}, ${input.threadId})`);
    return row.id;
  });
}

/** Events for a thread with id > afterId, oldest first. */
export async function listThreadEvents(
  db: Db,
  threadId: string,
  afterId = 0,
  limit = 500,
): Promise<ThreadEventRow[]> {
  return db
    .select({
      id: threadEvents.id,
      threadId: threadEvents.threadId,
      messageId: threadEvents.messageId,
      event: threadEvents.event,
    })
    .from(threadEvents)
    .where(and(eq(threadEvents.threadId, threadId), gt(threadEvents.id, afterId)))
    .orderBy(asc(threadEvents.id))
    .limit(limit);
}

/**
 * Wake-up hub for SSE tails. Subscribers are told "something may have been appended for this thread";
 * they then SELECT the rows themselves, so a lost or duplicate wake-up is harmless.
 */
export interface ThreadEventHub {
  /** `wake` is called on NOTIFY for `threadId`, after a LISTEN (re)connect, and every `pollMs` as a fallback. */
  subscribe(threadId: string, wake: () => void): () => void;
  /** Number of live subscriptions (diagnostics / leak tests). */
  size(): number;
  close(): Promise<void>;
}

export interface HubOptions {
  /** DIRECT (non-pooled) Neon URL. LISTEN does not work through PgBouncer transaction pooling. Omit for poll-only. */
  listenUrl?: string | undefined;
  pollMs?: number;
}

export function createThreadEventHub(opts: HubOptions = {}): ThreadEventHub {
  const pollMs = opts.pollMs ?? 2000;
  const subs = new Map<string, Set<() => void>>();
  const fire = (set: Set<() => void> | undefined) => {
    if (set) for (const w of [...set]) w();
  };

  // One dedicated connection for ALL streams (not one per client). postgres-js re-establishes the
  // connection and re-LISTENs on its own; `onlisten` then fires so every stream catches up on anything
  // missed while disconnected. If LISTEN cannot be set up at all we log once and polling carries on.
  let listener: ReturnType<typeof postgres> | undefined;
  if (opts.listenUrl) {
    const sql = postgres(opts.listenUrl, { max: 1, prepare: false, onnotice: () => {} });
    listener = sql;
    sql
      .listen(
        THREAD_EVENTS_CHANNEL,
        (threadId) => fire(subs.get(threadId)),
        () => {
          for (const set of subs.values()) fire(set);
        },
      )
      .catch((e: unknown) => {
        console.error(
          "[api] LISTEN thread_events failed; falling back to polling only:",
          e instanceof Error ? e.message : String(e),
        );
      });
  }

  return {
    subscribe(threadId, wake) {
      let set = subs.get(threadId);
      if (!set) {
        set = new Set();
        subs.set(threadId, set);
      }
      set.add(wake);
      const timer = setInterval(wake, pollMs);
      return () => {
        clearInterval(timer);
        const s = subs.get(threadId);
        s?.delete(wake);
        if (s && s.size === 0) subs.delete(threadId);
      };
    },
    size: () => [...subs.values()].reduce((n, s) => n + s.size, 0),
    async close() {
      await listener?.end({ timeout: 2 }).catch(() => {});
    },
  };
}
