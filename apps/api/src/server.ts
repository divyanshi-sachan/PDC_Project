import {
  and,
  artifacts,
  asc,
  type Db,
  desc,
  eq,
  inArray,
  listThreadEvents,
  messages,
  sql,
  type ThreadEventHub,
  threads,
} from "@dealpilot/db";
import {
  ChatEventSchema,
  type ChatTurnJob,
  CitationSchema,
  CreateThreadBodySchema,
  type Message,
  PostMessageBodySchema,
  type Thread,
} from "@dealpilot/shared";
import express, { type Express, type RequestHandler } from "express";
import type { JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { requireUser, userOf } from "./auth.ts";
import { ApiError, errorMiddleware, notFound, notFoundHandler } from "./errors.ts";
import "./types.ts";

export interface Deps {
  db: Db;
  /** Enqueue a chat turn (production: pg-boss `send` with `singletonKey` = job.messageId). */
  enqueue: (job: ChatTurnJob) => Promise<void>;
  jwks: JWTVerifyGetKey;
  /** Origin of NEON_AUTH_BASE_URL; checked against the token's `iss` when present. */
  issuer?: string | undefined;
  hub: ThreadEventHub;
  /** Presigned download URL for a storage key. */
  signedUrl: (key: string) => Promise<string>;
  webOrigins?: string[];
  /** Max queued/running assistant messages per user. Default 5. */
  maxActivePerUser?: number;
  sseHeartbeatMs?: number;
}

const idParam = z.object({ id: z.uuid() });
const sseQuery = z.object({ after: z.coerce.number().int().min(0).optional() });
const lastEventIdHeader = z.coerce.number().int().min(0);

const toIso = (d: Date) => d.toISOString();

function toThread(r: typeof threads.$inferSelect): Thread {
  return {
    id: r.id,
    title: r.title ?? "New chat",
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  };
}

function toMessage(r: typeof messages.$inferSelect): Message {
  const cites = z.array(CitationSchema).safeParse(r.citations);
  return {
    id: r.id,
    threadId: r.threadId,
    role: r.role,
    text: r.text,
    citations: cites.success ? cites.data : [],
    status: r.status,
    createdAt: toIso(r.createdAt),
  };
}

export function createApp(deps: Deps): Express {
  const { db } = deps;
  const maxActive = deps.maxActivePerUser ?? 5;
  const webOrigins = deps.webOrigins ?? ["http://localhost:3000"];
  const auth = requireUser({ jwks: deps.jwks, issuer: deps.issuer });
  const sseAuth = requireUser({ jwks: deps.jwks, issuer: deps.issuer }, { allowQueryToken: true });

  const app = express();
  app.disable("x-powered-by");

  // Basic security headers by hand (helmet-style).
  const secure: RequestHandler = (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  };
  const cors: RequestHandler = (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && webOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Last-Event-ID");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
  app.use(secure, cors);
  app.use(express.json({ limit: "32kb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  /** Thread row owned by `userId`, or 404 (never 403: don't reveal existence). */
  async function ownedThread(threadId: string, userId: string) {
    const [row] = await db
      .select()
      .from(threads)
      .where(and(eq(threads.id, threadId), eq(threads.userId, userId)));
    if (!row) throw notFound("thread");
    return row;
  }

  app.post("/threads", auth, async (req, res) => {
    const body = CreateThreadBodySchema.parse(req.body ?? {});
    const [row] = await db
      .insert(threads)
      .values({ userId: userOf(req).id, title: body.title ?? null })
      .returning();
    if (!row) throw new Error("thread insert returned no row");
    res.status(201).json(toThread(row));
  });

  app.get("/threads", auth, async (req, res) => {
    const rows = await db
      .select()
      .from(threads)
      .where(eq(threads.userId, userOf(req).id))
      .orderBy(desc(threads.updatedAt), desc(threads.createdAt))
      .limit(200);
    res.json(rows.map(toThread));
  });

  app.get("/threads/:id/messages", auth, async (req, res) => {
    const { id } = idParam.parse(req.params);
    await ownedThread(id, userOf(req).id);
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.threadId, id))
      .orderBy(asc(messages.createdAt), asc(messages.role));
    res.json(rows.map(toMessage));
  });

  app.post("/threads/:id/messages", auth, async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { text } = PostMessageBodySchema.parse(req.body);
    const userId = userOf(req).id;
    await ownedThread(id, userId);

    const userAt = new Date();
    const assistantAt = new Date(userAt.getTime() + 1); // distinct timestamps keep ordering stable
    const { userMsg, assistantMsg } = await db.transaction(async (tx) => {
      // Serialise per user so concurrent POSTs cannot both slip under the limit.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
      const [active] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(messages)
        .innerJoin(threads, eq(threads.id, messages.threadId))
        .where(and(eq(threads.userId, userId), inArray(messages.status, ["queued", "running"])));
      if ((active?.n ?? 0) >= maxActive) {
        throw new ApiError(
          429,
          "rate_limited",
          `at most ${maxActive} messages may be queued or running at once`,
        );
      }
      const [u] = await tx
        .insert(messages)
        .values({ threadId: id, role: "user", text, status: "done", createdAt: userAt })
        .returning();
      const [a] = await tx
        .insert(messages)
        .values({ threadId: id, role: "assistant", text: "", status: "queued", createdAt: assistantAt })
        .returning();
      await tx
        .update(threads)
        .set({ updatedAt: new Date(), title: sql`coalesce(${threads.title}, left(${text}, 60))` })
        .where(eq(threads.id, id));
      if (!u || !a) throw new Error("message insert returned no row");
      return { userMsg: u, assistantMsg: a };
    });

    // Enqueue only after commit so the worker can always see the rows.
    try {
      await deps.enqueue({
        threadId: id,
        messageId: userMsg.id,
        assistantMessageId: assistantMsg.id,
        userId,
        text,
      });
    } catch (e) {
      console.error("[api] enqueue failed:", e instanceof Error ? e.message : String(e));
      await db.update(messages).set({ status: "failed" }).where(eq(messages.id, assistantMsg.id));
      throw new ApiError(503, "queue_unavailable", "could not enqueue the message; try again");
    }
    res.status(202).json({ userMessage: toMessage(userMsg), assistantMessage: toMessage(assistantMsg) });
  });

  app.get("/threads/:id/events", sseAuth, async (req, res) => {
    const { id } = idParam.parse(req.params);
    const q = sseQuery.parse(req.query);
    const hdr = req.headers["last-event-id"];
    const fromHeader = typeof hdr === "string" && hdr !== "" ? lastEventIdHeader.parse(hdr) : undefined;
    let lastId = fromHeader ?? q.after ?? 0;
    await ownedThread(id, userOf(req).id);

    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 3000\n\n");

    let closed = false;
    let draining = false;
    let again = false;
    const drain = async (): Promise<void> => {
      if (draining) {
        again = true;
        return;
      }
      draining = true;
      try {
        do {
          again = false;
          for (;;) {
            const rows = await listThreadEvents(db, id, lastId, 200);
            if (closed) return;
            for (const r of rows) {
              lastId = r.id;
              const parsed = ChatEventSchema.safeParse(r.event);
              if (!parsed.success) {
                console.error(`[api] skipping malformed thread event ${r.id}`);
                continue;
              }
              res.write(`id: ${r.id}\nevent: ${parsed.data.type}\ndata: ${JSON.stringify(r.event)}\n\n`);
            }
            if (rows.length < 200) break;
          }
        } while (again && !closed);
      } catch (e) {
        // Transient DB error: the next wake-up / poll retries from lastId.
        console.error("[api] sse drain failed:", e instanceof Error ? e.message : String(e));
      } finally {
        draining = false;
      }
    };

    const unsubscribe = deps.hub.subscribe(id, () => void drain());
    const ping = setInterval(() => {
      if (!closed) res.write(": ping\n\n");
    }, deps.sseHeartbeatMs ?? 15_000);
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      unsubscribe();
      res.end();
    };
    req.on("close", cleanup);
    res.on("error", cleanup);
    await drain(); // replay
  });

  app.get("/artifacts/:id", auth, async (req, res) => {
    const { id } = idParam.parse(req.params);
    const userId = userOf(req).id;
    // artifacts/tasks carry no userId yet: ownership flows through messages.taskId → threads.userId.
    const [row] = await db
      .select({ storageKey: artifacts.storageKey })
      .from(artifacts)
      .innerJoin(messages, eq(messages.taskId, artifacts.taskId))
      .innerJoin(threads, eq(threads.id, messages.threadId))
      .where(and(eq(artifacts.id, id), eq(threads.userId, userId)))
      .limit(1);
    if (!row) throw notFound("artifact");
    res.redirect(302, await deps.signedUrl(row.storageKey));
  });

  app.use(notFoundHandler);
  app.use(errorMiddleware);
  return app;
}
