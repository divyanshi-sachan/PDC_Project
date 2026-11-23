/**
 * Builds the downloadable deliverables for a finished valuation (Excel model, memo, audit trail), stores them in
 * object storage under `tasks/<taskId>/` and records them in the `artifacts` table, plus the Verifier's defects in
 * the `defects` table. The graph calls this after verification; a failure here never fails the turn.
 */
import {
  artifacts,
  asc,
  type Db,
  defects as defectsTable,
  eq,
  threadEvents,
  traceEvents,
} from "@dealpilot/db";
import { buildAuditTrail, buildMemo, buildWorkbook, type LlmCallRecord } from "@dealpilot/deliverables";
import { type ArtifactRef, type ChatEvent, ChatEventSchema, type Panel } from "@dealpilot/shared";
import { type ArtifactStore, artifactKey } from "@dealpilot/storage";

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface DeliverContext {
  db: Db;
  store: ArtifactStore;
  taskId: string;
  messageId: string;
  now?: () => Date;
}

export function makeDeliver(ctx: DeliverContext) {
  return async (input: {
    panel: Panel;
    request: string;
    commentary: string | null;
  }): Promise<ArtifactRef[]> => {
    const { panel } = input;
    const now = ctx.now ?? (() => new Date());

    const rows = await ctx.db
      .select({ event: threadEvents.event })
      .from(threadEvents)
      .where(eq(threadEvents.messageId, ctx.messageId))
      .orderBy(asc(threadEvents.id));
    const events = rows.flatMap((r) => {
      const p = ChatEventSchema.safeParse(r.event);
      return p.success ? [p.data as ChatEvent] : [];
    });
    const calls = await ctx.db
      .select()
      .from(traceEvents)
      .where(eq(traceEvents.taskId, ctx.taskId))
      .orderBy(asc(traceEvents.createdAt));
    const llmCalls: LlmCallRecord[] = calls
      .filter((c) => c.kind === "llm_call")
      .map((c) => ({
        node: c.node,
        model: c.model,
        group: (c.payload as { group?: string } | null)?.group ?? null,
        inputTokens: c.inputTokens ?? 0,
        outputTokens: c.outputTokens ?? 0,
        costUsd: c.costUsd ?? 0,
        latencyMs: c.latencyMs,
      }));

    const audit = buildAuditTrail({
      panel,
      request: input.request,
      events,
      llmCalls,
      generatedAt: now(),
    });
    const t = panel.ticker.toUpperCase();
    const files: {
      kind: ArtifactRef["kind"];
      filename: string;
      contentType: string;
      body: Uint8Array | string;
    }[] = [
      {
        kind: "xlsx",
        filename: `${t}-dcf-model.xlsx`,
        contentType: XLSX_TYPE,
        body: await buildWorkbook(panel),
      },
      {
        kind: "docx",
        filename: `${t}-valuation-memo.docx`,
        contentType: DOCX_TYPE,
        body: await buildMemo(panel, { commentary: input.commentary }),
      },
      { kind: "json", filename: `${t}-audit-trail.json`, contentType: "application/json", body: audit.json },
      {
        kind: "md",
        filename: `${t}-audit-trail.md`,
        contentType: "text/markdown; charset=utf-8",
        body: audit.markdown,
      },
    ];

    const out: ArtifactRef[] = [];
    for (const f of files) {
      const key = artifactKey(ctx.taskId, f.filename);
      const { size } = await ctx.store.put(key, f.body, f.contentType);
      const [row] = await ctx.db
        .insert(artifacts)
        .values({
          taskId: ctx.taskId,
          kind: f.kind,
          filename: f.filename,
          storageKey: key,
          contentType: f.contentType,
          sizeBytes: size,
        })
        .onConflictDoUpdate({
          target: artifacts.storageKey,
          set: { sizeBytes: size, contentType: f.contentType },
        })
        .returning({ id: artifacts.id });
      if (row) out.push({ id: row.id, kind: f.kind, filename: f.filename, sizeBytes: size });
    }

    const found = panel.verification?.defects ?? [];
    if (found.length) {
      await ctx.db.insert(defectsTable).values(
        found.map((d) => ({
          taskId: ctx.taskId,
          type: d.type,
          ownerNode: d.ownerNode,
          detail: {
            subject: d.subject,
            severity: d.severity,
            text: d.detail,
            expected: d.expected,
            actual: d.actual,
          },
          status: d.status,
          retries: d.retries,
        })),
      );
    }
    return out;
  };
}
