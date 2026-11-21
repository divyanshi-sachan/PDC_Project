import { randomUUID } from "node:crypto";
import {
  appendThreadEvent,
  artifacts,
  createDb,
  createThreadEventHub,
  directDatabaseUrl,
  eq,
  inArray,
  messages,
  tasks,
  threads,
} from "@dealpilot/db";
import { ApiErrorSchema, type ChatTurnJob, MessageSchema, ThreadSchema } from "@dealpilot/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "./server.ts";
import { listen, makeKeys, openSse } from "./test-helpers.ts";

const URL_ = process.env.TEST_DATABASE_URL;

describe.skipIf(!URL_)("chat API (Neon dev branch)", { timeout: 30_000 }, () => {
  let db: ReturnType<typeof createDb>;
  let hub: ReturnType<typeof createThreadEventHub>;
  let srv: Awaited<ReturnType<typeof listen>>;
  let sign: Awaited<ReturnType<typeof makeKeys>>["sign"];
  const jobs: ChatTurnJob[] = [];
  let failEnqueue = false;
  const alice = `test-alice-${randomUUID()}`;
  const bob = `test-bob-${randomUUID()}`;
  let aliceTok: string;
  let bobTok: string;
  const taskIds: string[] = [];

  const call = (path: string, tok: string, init: RequestInit = {}) =>
    fetch(srv.url + path, {
      ...init,
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", ...init.headers },
    });
  const post = (path: string, tok: string, body: unknown) =>
    call(path, tok, { method: "POST", body: JSON.stringify(body) });
  const mkThread = async (tok: string) => ThreadSchema.parse(await (await post("/threads", tok, {})).json());

  beforeAll(async () => {
    db = createDb(URL_ as string);
    hub = createThreadEventHub({ listenUrl: directDatabaseUrl(), pollMs: 60_000 }); // LISTEN-driven
    const keys = await makeKeys();
    sign = keys.sign;
    srv = await listen(
      createApp({
        db: db.db,
        hub,
        jwks: keys.jwks,
        issuer: "https://auth.example.test",
        webOrigins: ["http://localhost:3000"],
        signedUrl: async (k) => `https://storage.example.test/${k}?sig=1`,
        sseHeartbeatMs: 300,
        enqueue: async (j) => {
          if (failEnqueue) throw new Error("boom");
          jobs.push(j);
        },
      }),
    );
    aliceTok = await sign(alice, { exp: "1h" });
    bobTok = await sign(bob, { exp: "1h" });
  });
  beforeEach(() => {
    jobs.length = 0;
    failEnqueue = false;
  });
  afterAll(async () => {
    await srv.close();
    await hub.close();
    await db.db.delete(threads).where(inArray(threads.userId, [alice, bob]));
    if (taskIds.length) {
      await db.db.delete(artifacts).where(inArray(artifacts.taskId, taskIds));
      await db.db.delete(tasks).where(inArray(tasks.id, taskIds));
    }
    await db.close();
  });

  it("healthz needs no auth, and sets security + CORS headers", async () => {
    const res = await fetch(`${srv.url}/healthz`, { headers: { Origin: "http://localhost:3000" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const evil = await fetch(`${srv.url}/healthz`, { headers: { Origin: "https://evil.test" } });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await fetch(`${srv.url}/threads`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3000" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")).toContain("Last-Event-ID");
  });

  it("requires auth on every other route", async () => {
    for (const p of ["/threads", `/threads/${randomUUID()}/messages`, `/artifacts/${randomUUID()}`]) {
      const res = await fetch(srv.url + p);
      expect(res.status).toBe(401);
      expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("unauthorized");
    }
  });

  it("creates and lists threads newest first, per user", async () => {
    const t1 = await mkThread(aliceTok);
    const t2 = await mkThread(aliceTok);
    const list = z.array(ThreadSchema).parse(await (await call("/threads", aliceTok)).json());
    const ids = list.map((t) => t.id);
    expect(ids.indexOf(t2.id)).toBeLessThan(ids.indexOf(t1.id));
    const bobList = z.array(ThreadSchema).parse(await (await call("/threads", bobTok)).json());
    expect(bobList.find((t) => t.id === t1.id)).toBeUndefined();
  });

  it("isolates users: another user's thread is 404 on every route", async () => {
    const t = await mkThread(aliceTok);
    for (const [path, init] of [
      [`/threads/${t.id}/messages`, {}],
      [`/threads/${t.id}/messages`, { method: "POST", body: JSON.stringify({ text: "hi" }) }],
      [`/threads/${t.id}/events`, {}],
    ] as const) {
      const res = await call(path, bobTok, init);
      expect(res.status).toBe(404);
      expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("not_found");
    }
    expect(jobs).toHaveLength(0);
  });

  it("validates input with 422 validation_error", async () => {
    const t = await mkThread(aliceTok);
    for (const body of [{}, { text: "" }, { text: "   " }, { text: "x".repeat(4001) }, { text: 5 }]) {
      const res = await post(`/threads/${t.id}/messages`, aliceTok, body);
      expect(res.status).toBe(422);
      expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("validation_error");
    }
    expect((await call("/threads/not-a-uuid/messages", aliceTok)).status).toBe(422);
    expect((await post("/threads", aliceTok, { title: "" })).status).toBe(422);
    const bad = await call("/threads", aliceTok, { method: "POST", body: "{nope" });
    expect(bad.status).toBe(400);
    expect(ApiErrorSchema.parse(await bad.json()).error.code).toBe("bad_json");
    const badAfter = await call(`/threads/${t.id}/events?after=abc`, aliceTok);
    expect(badAfter.status).toBe(422);
    expect(jobs).toHaveLength(0);
  });

  it("returns a typed 404 for unknown routes", async () => {
    const res = await call("/nope", aliceTok);
    expect(res.status).toBe(404);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("not_found");
  });

  it("POST message: 202, stores both messages, enqueues the right job", async () => {
    const t = await mkThread(aliceTok);
    const res = await post(`/threads/${t.id}/messages`, aliceTok, { text: "  Value AAPL  " });
    expect(res.status).toBe(202);
    const body = z
      .object({ userMessage: MessageSchema, assistantMessage: MessageSchema })
      .parse(await res.json());
    expect(body.userMessage).toMatchObject({
      role: "user",
      text: "Value AAPL",
      status: "done",
      threadId: t.id,
    });
    expect(body.assistantMessage).toMatchObject({ role: "assistant", text: "", status: "queued" });
    expect(jobs).toEqual([
      {
        threadId: t.id,
        messageId: body.userMessage.id,
        assistantMessageId: body.assistantMessage.id,
        userId: alice,
        text: "Value AAPL",
      },
    ]);

    const msgs = z
      .array(MessageSchema)
      .parse(await (await call(`/threads/${t.id}/messages`, aliceTok)).json());
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    const list = z.array(ThreadSchema).parse(await (await call("/threads", aliceTok)).json());
    expect(list.find((x) => x.id === t.id)?.title).toBe("Value AAPL");
  });

  it("marks the assistant message failed and returns 503 when enqueue fails", async () => {
    const t = await mkThread(aliceTok);
    failEnqueue = true;
    const res = await post(`/threads/${t.id}/messages`, aliceTok, { text: "x" });
    expect(res.status).toBe(503);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("queue_unavailable");
    const msgs = z
      .array(MessageSchema)
      .parse(await (await call(`/threads/${t.id}/messages`, aliceTok)).json());
    expect(msgs.find((m) => m.role === "assistant")?.status).toBe("failed");
  });

  it("rate limits at 5 queued/running messages per user (429), per user not global", async () => {
    const carol = `test-carol-${randomUUID()}`;
    const carolTok = await sign(carol, { exp: "1h" });
    try {
      const t = await mkThread(carolTok);
      for (let i = 0; i < 5; i++) {
        expect((await post(`/threads/${t.id}/messages`, carolTok, { text: `m${i}` })).status).toBe(202);
      }
      const res = await post(`/threads/${t.id}/messages`, carolTok, { text: "one too many" });
      expect(res.status).toBe(429);
      expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("rate_limited");
      expect(jobs).toHaveLength(5);
      // another user is unaffected
      const bt = await mkThread(bobTok);
      expect((await post(`/threads/${bt.id}/messages`, bobTok, { text: "fine" })).status).toBe(202);
      // finishing one frees a slot
      const asst = await db.db.select().from(messages).where(eq(messages.threadId, t.id));
      const queued = asst.find((m) => m.role === "assistant" && m.status === "queued");
      expect(queued).toBeDefined();
      if (queued) await db.db.update(messages).set({ status: "done" }).where(eq(messages.id, queued.id));
      expect((await post(`/threads/${t.id}/messages`, carolTok, { text: "again" })).status).toBe(202);
    } finally {
      await db.db.delete(threads).where(eq(threads.userId, carol));
    }
  });

  describe("artifacts", () => {
    it("redirects the owner to a presigned URL, 404 for others and for unlinked artifacts", async () => {
      const t = await mkThread(aliceTok);
      const [task] = await db.db.insert(tasks).values({ ticker: "TEST", request: {} }).returning();
      const [orphanTask] = await db.db.insert(tasks).values({ ticker: "TEST", request: {} }).returning();
      if (!task || !orphanTask) throw new Error("task insert");
      taskIds.push(task.id, orphanTask.id);
      const mk = (taskId: string, key: string) =>
        db.db
          .insert(artifacts)
          .values({
            taskId,
            kind: "json",
            filename: "a.json",
            storageKey: key,
            contentType: "application/json",
            sizeBytes: 1,
          })
          .returning();
      const [art] = await mk(task.id, `tasks/${task.id}/a.json`);
      const [orphan] = await mk(orphanTask.id, `tasks/${orphanTask.id}/a.json`);
      if (!art || !orphan) throw new Error("artifact insert");
      await db.db
        .insert(messages)
        .values({ threadId: t.id, role: "assistant", text: "d", status: "done", taskId: task.id });

      const ok = await call(`/artifacts/${art.id}`, aliceTok, { redirect: "manual" });
      expect(ok.status).toBe(302);
      expect(ok.headers.get("location")).toBe(`https://storage.example.test/tasks/${task.id}/a.json?sig=1`);
      expect((await call(`/artifacts/${art.id}`, bobTok, { redirect: "manual" })).status).toBe(404);
      expect((await call(`/artifacts/${orphan.id}`, aliceTok, { redirect: "manual" })).status).toBe(404);
    });
  });

  describe("SSE", () => {
    const ev = (n: number) => ({
      type: "step",
      stepId: `s${n}`,
      node: "research",
      status: "started",
      label: `step ${n}`,
      detail: null,
    });

    it("replays, tails via LISTEN, honours Last-Event-ID / ?after, pings, and cleans up", async () => {
      const t = await mkThread(aliceTok);
      const id1 = await appendThreadEvent(db.db, { threadId: t.id, messageId: null, event: ev(1) });
      const id2 = await appendThreadEvent(db.db, { threadId: t.id, messageId: null, event: ev(2) });

      const sse = await openSse(`${srv.url}/threads/${t.id}/events`, {
        headers: { Authorization: `Bearer ${aliceTok}` },
      });
      expect(sse.res.status).toBe(200);
      expect(sse.res.headers.get("content-type")).toContain("text/event-stream");
      await sse.until((m) => m.filter((x) => x.id).length === 2);
      expect(sse.msgs.filter((m) => m.id).map((m) => [m.id, m.event])).toEqual([
        [String(id1), "step"],
        [String(id2), "step"],
      ]);
      expect(JSON.parse(sse.msgs[0]?.data ?? "{}")).toMatchObject({ type: "step", stepId: "s1" });

      // tail: pollMs is 60 s, so this arrives only through LISTEN/NOTIFY
      expect(hub.size()).toBe(1);
      const t0 = Date.now();
      const id3 = await appendThreadEvent(db.db, {
        threadId: t.id,
        messageId: null,
        event: { type: "done" },
      });
      await sse.until((m) => m.some((x) => x.id === String(id3)), 5000);
      expect(Date.now() - t0).toBeLessThan(5000);
      expect(sse.msgs.find((m) => m.id === String(id3))?.event).toBe("done");

      // a `done` event does not close the stream: later turns still arrive
      const id4 = await appendThreadEvent(db.db, { threadId: t.id, messageId: null, event: ev(4) });
      await sse.until((m) => m.some((x) => x.id === String(id4)));

      // heartbeat
      await sse.until((m) => m.some((x) => x.comment === "ping"));

      // events of another thread never leak in
      const other = await mkThread(aliceTok);
      await appendThreadEvent(db.db, { threadId: other.id, messageId: null, event: ev(9) });
      await new Promise((r) => setTimeout(r, 300));
      expect(sse.msgs.some((m) => m.data?.includes('"s9"'))).toBe(false);

      sse.abort();
      await sse.done;
      for (let i = 0; i < 50 && hub.size() > 0; i++) await new Promise((r) => setTimeout(r, 50));
      expect(hub.size()).toBe(0);

      // Last-Event-ID header
      const h = await openSse(`${srv.url}/threads/${t.id}/events`, {
        headers: { Authorization: `Bearer ${aliceTok}`, "Last-Event-ID": String(id2) },
      });
      await h.until((m) => m.filter((x) => x.id).length === 2);
      expect(h.msgs.filter((m) => m.id).map((m) => m.id)).toEqual([String(id3), String(id4)]);
      h.abort();
      await h.done;

      // ?after= plus ?access_token= (EventSource style, no headers)
      const q = await openSse(`${srv.url}/threads/${t.id}/events?after=${id3}&access_token=${aliceTok}`);
      await q.until((m) => m.some((x) => x.id === String(id4)));
      expect(q.msgs.filter((m) => m.id).map((m) => m.id)).toEqual([String(id4)]);
      q.abort();
      await q.done;
    });

    it("rejects a bad token on the SSE route with 401 and does not open a stream", async () => {
      const t = await mkThread(aliceTok);
      const res = await fetch(`${srv.url}/threads/${t.id}/events?access_token=garbage`);
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toContain("application/json");
    });
  });
});

describe.skipIf(!URL_)("poll-only fallback (no LISTEN)", () => {
  it("still delivers appended events within the poll interval", async () => {
    const db = createDb(URL_ as string);
    const hub = createThreadEventHub({ pollMs: 100 });
    const keys = await makeKeys();
    const userId = `test-poll-${randomUUID()}`;
    const srv = await listen(
      createApp({ db: db.db, hub, jwks: keys.jwks, signedUrl: async () => "", enqueue: async () => {} }),
    );
    try {
      const tok = await keys.sign(userId);
      const t = z.object({ id: z.uuid() }).parse(
        await (
          await fetch(`${srv.url}/threads`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
            body: "{}",
          })
        ).json(),
      );
      const sse = await openSse(`${srv.url}/threads/${t.id}/events`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const id = await appendThreadEvent(db.db, { threadId: t.id, event: { type: "done" } });
      await sse.until((m) => m.some((x) => x.id === String(id)));
      sse.abort();
      await sse.done;
    } finally {
      await srv.close();
      await hub.close();
      await db.db.delete(threads).where(eq(threads.userId, userId));
      await db.close();
    }
  });
});
