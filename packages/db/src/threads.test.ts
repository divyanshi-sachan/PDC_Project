import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "./client.ts";
import { directDatabaseUrl } from "./env.ts";
import { threads } from "./schema.ts";
import { appendThreadEvent, createThreadEventHub, listThreadEvents } from "./threads.ts";

const URL_ = process.env.TEST_DATABASE_URL;

describe("thread hub (no DB)", () => {
  it("polls, unsubscribes and reports size", async () => {
    const hub = createThreadEventHub({ pollMs: 20 });
    let n = 0;
    const off = hub.subscribe("t", () => n++);
    expect(hub.size()).toBe(1);
    await new Promise((r) => setTimeout(r, 90));
    expect(n).toBeGreaterThanOrEqual(2);
    off();
    expect(hub.size()).toBe(0);
    const seen = n;
    await new Promise((r) => setTimeout(r, 60));
    expect(n).toBe(seen);
    await hub.close();
  });
});

describe.skipIf(!URL_)("thread events (Neon dev branch)", () => {
  const userId = `test-db-${randomUUID()}`;
  const c = createDb(URL_ as string);
  afterAll(async () => {
    await c.db.delete(threads).where(eq(threads.userId, userId));
    await c.close();
  });

  it("appends in order and lists strictly after an id", async () => {
    const [t] = await c.db.insert(threads).values({ userId }).returning();
    if (!t) throw new Error("no thread");
    const a = await appendThreadEvent(c.db, { threadId: t.id, event: { type: "done" } });
    const b = await appendThreadEvent(c.db, {
      threadId: t.id,
      messageId: randomUUID(),
      event: { type: "done" },
    });
    expect(b).toBeGreaterThan(a);
    expect((await listThreadEvents(c.db, t.id, 0)).map((r) => r.id)).toEqual([a, b]);
    expect((await listThreadEvents(c.db, t.id, a)).map((r) => r.id)).toEqual([b]);
    expect(await listThreadEvents(c.db, t.id, b)).toEqual([]);
  });

  it("wakes a subscriber via NOTIFY on a direct connection (poll disabled)", async () => {
    const [t] = await c.db.insert(threads).values({ userId }).returning();
    if (!t) throw new Error("no thread");
    const hub = createThreadEventHub({ listenUrl: directDatabaseUrl(), pollMs: 600_000 });
    try {
      let woke = 0;
      const off = hub.subscribe(t.id, () => woke++);
      await new Promise((r) => setTimeout(r, 1500)); // LISTEN established (its onlisten wake counts too)
      const before = woke;
      await appendThreadEvent(c.db, { threadId: t.id, event: { type: "done" } });
      for (let i = 0; i < 60 && woke === before; i++) await new Promise((r) => setTimeout(r, 50));
      expect(woke).toBeGreaterThan(before);
      off();
    } finally {
      await hub.close();
    }
  });
});
