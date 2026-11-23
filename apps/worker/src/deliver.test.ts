import { randomUUID } from "node:crypto";
import {
  appendThreadEvent,
  artifacts,
  createDb,
  defects,
  eq,
  tasks,
  threads,
  traceEvents,
} from "@dealpilot/db";
import { samplePanel } from "@dealpilot/deliverables/testkit";
import type { ArtifactStore } from "@dealpilot/storage";
import JSZip from "jszip";
import { afterAll, describe, expect, it } from "vitest";
import { makeDeliver } from "./deliver.ts";

const URL_ = process.env.TEST_DATABASE_URL;

function memoryStore(): ArtifactStore & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key, body) {
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
      objects.set(key, bytes);
      return { key, size: bytes.byteLength };
    },
    async get(key) {
      const b = objects.get(key);
      if (!b) throw new Error("missing");
      return b;
    },
    async exists(key) {
      return objects.has(key);
    },
    async delete(key) {
      objects.delete(key);
    },
    async signedUrl(key) {
      return `memory://${key}`;
    },
  };
}

describe.skipIf(!URL_)("deliverables (Neon dev branch, in-memory object store)", () => {
  const userId = `test-deliver-${randomUUID()}`;
  const c = createDb(URL_ as string);
  const taskIds: string[] = [];
  afterAll(async () => {
    for (const id of taskIds) {
      await c.db.delete(artifacts).where(eq(artifacts.taskId, id));
      await c.db.delete(defects).where(eq(defects.taskId, id));
      await c.db.delete(traceEvents).where(eq(traceEvents.taskId, id));
      await c.db.delete(tasks).where(eq(tasks.id, id));
    }
    await c.db.delete(threads).where(eq(threads.userId, userId));
    await c.close();
  });

  it("stores an xlsx, a docx and the audit trail, records them, and reads the turn's timeline and costs", async () => {
    const [thread] = await c.db.insert(threads).values({ userId }).returning();
    const [task] = await c.db
      .insert(tasks)
      .values({ ticker: "TESTCO", request: { text: "Value TestCo" }, status: "running" })
      .returning();
    if (!thread || !task) throw new Error("setup failed");
    taskIds.push(task.id);
    const messageId = randomUUID();
    await appendThreadEvent(c.db, {
      threadId: thread.id,
      messageId,
      event: {
        type: "step",
        stepId: "r1",
        node: "research",
        status: "done",
        label: "Reading TestCo filings",
        detail: null,
      },
    });
    await c.db.insert(traceEvents).values({
      taskId: task.id,
      node: "modeling.assumptions",
      kind: "llm_call",
      payload: { group: "dp-producer-paid", attempt: 1 },
      model: "haiku",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.0012,
      latencyMs: 800,
    });

    const store = memoryStore();
    const panel = await samplePanel();
    const refs = await makeDeliver({ db: c.db, store, taskId: task.id, messageId })({
      panel,
      request: "Value TestCo",
      commentary: null,
    });

    expect(refs.map((r) => r.kind).sort()).toEqual(["docx", "json", "md", "xlsx"]);
    const rows = await c.db.select().from(artifacts).where(eq(artifacts.taskId, task.id));
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(store.objects.get(r.storageKey)?.byteLength).toBe(r.sizeBytes);

    const xlsx = rows.find((r) => r.kind === "xlsx");
    const zip = await JSZip.loadAsync(store.objects.get(xlsx?.storageKey ?? "") as Uint8Array);
    expect(Object.keys(zip.files)).toContain("xl/workbook.xml");

    const audit = JSON.parse(
      new TextDecoder().decode(store.objects.get(rows.find((r) => r.kind === "json")?.storageKey ?? "")),
    );
    expect(audit.steps.map((s: { label: string }) => s.label)).toContain("Reading TestCo filings");
    expect(audit.cost.totalUsd).toBeCloseTo(0.0012, 9);
  });
});
