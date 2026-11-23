import JSZip from "jszip";
import { describe, expect, test } from "vitest";
import { buildAuditTrail, panelHash } from "./audit.ts";
import { samplePanel } from "./fixture.ts";
import { buildMemo } from "./memo.ts";

async function xml(bytes: Uint8Array, file: string) {
  const zip = await JSZip.loadAsync(bytes);
  return (await zip.file(file)?.async("string")) ?? "";
}
const text = (x: string) => x.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("memo", () => {
  test("states the computed figures, verification status and evidence footnotes", async () => {
    const panel = await samplePanel();
    const bytes = await buildMemo(panel, { commentary: "A short qualitative remark." });
    const body = text(await xml(bytes, "word/document.xml"));
    expect(body).toContain(`$${panel.valuation.perShare.toFixed(2)} per share`);
    expect(body).toMatch(/Independently verified: \d+ of \d+ checks passed/);
    expect(body).toContain("A short qualitative remark.");
    const notes = text(await xml(bytes, "word/footnotes.xml"));
    expect(notes).toMatch(/accession/);
  });

  test("an unverified panel is flagged at the top of the memo", async () => {
    const body = text(await xml(await buildMemo(await samplePanel({ verify: false })), "word/document.xml"));
    expect(body).toContain("NOT VERIFIED");
  });
});

describe("audit trail", () => {
  test("hash is stable, JSON parses, and the timeline and costs are listed", async () => {
    const panel = await samplePanel();
    expect(panelHash(panel)).toBe(panelHash(JSON.parse(JSON.stringify(panel))));
    expect(panelHash(panel)).not.toBe(panelHash({ ...panel, price: 1 }));
    const a = buildAuditTrail({
      panel,
      request: "Value TestCo",
      events: [
        {
          type: "step",
          stepId: "s1",
          node: "research",
          status: "done",
          label: "Reading filings",
          detail: null,
        },
      ],
      llmCalls: [
        {
          node: "modeling.assumptions",
          model: "haiku",
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.001,
          latencyMs: 900,
        },
      ],
      generatedAt: new Date("2026-11-23T00:00:00Z"),
    });
    const parsed = JSON.parse(a.json);
    expect(parsed.panelSha256).toBe(a.panelSha256);
    expect(parsed.verification.verified).toBe(true);
    expect(parsed.cost.totalUsd).toBeCloseTo(0.001, 9);
    expect(a.markdown).toContain("[research] Reading filings");
    expect(a.markdown).toContain(a.panelSha256);
  });
});
