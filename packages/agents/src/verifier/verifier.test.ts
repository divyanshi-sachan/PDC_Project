import type { Panel } from "@dealpilot/shared";
import { describe, expect, test } from "vitest";
import { buildSnapshot, computePanel } from "../modeling/index.ts";
import { formatAnalysisMessage } from "../respond.ts";
import { company, fakeEdgar, fakeMarket, fakeModel } from "../testkit.ts";
import { buildReport, runVerifier, trackDefects } from "./index.ts";

const edgar = fakeEdgar([company("TESTCO")]).client;

async function goodPanel(): Promise<Panel> {
  const snap = await buildSnapshot(
    {
      llm: fakeModel({ routes: [], peers: [] }).client,
      edgar,
      market: fakeMarket({
        quotes: { TESTCO: { price: 20, marketCap: 2_000_000_000 } },
        beta: 1.2,
        riskFree: 0.04,
        peers: [],
      }),
      now: () => new Date("2026-11-21T00:00:00Z"),
    },
    "TESTCO",
  );
  return computePanel(snap);
}

const run = (panel: Panel, message?: string) =>
  runVerifier({ edgar }, { panel, message: message ?? formatAnalysisMessage(panel, []).text, changes: [] });
const errors = (r: Awaited<ReturnType<typeof run>>) => r.defects.filter((d) => d.severity === "error");

describe("verifier on a clean panel", () => {
  test("passes every check", async () => {
    const r = await run(await goodPanel());
    expect(errors(r)).toEqual([]);
    expect(r.checks.map((c) => c.name)).toEqual([
      "recompute_valuation",
      "integrity",
      "resolve_citations",
      "message_consistency",
    ]);
    expect(r.checks.every((c) => c.passed)).toBe(true);
  });
});

describe("error injection", () => {
  test("wrong number: a tampered per-share value is a calc_mismatch owned by modeling", async () => {
    const p = await goodPanel();
    p.valuation = { ...p.valuation, perShare: p.valuation.perShare * 1.1 };
    const r = await run(p);
    const d = errors(r).find((x) => x.type === "calc_mismatch");
    expect(d?.ownerNode).toBe("modeling");
  });

  test("wrong number: a tampered assumption no longer reproduces the stated value", async () => {
    const p = await goodPanel();
    p.assumptions = p.assumptions.map((a) => (a.key === "tax_rate" ? { ...a, value: a.value + 0.05 } : a));
    expect(errors(await run(p)).some((x) => x.type === "calc_mismatch")).toBe(true);
  });

  test("fake citation: an accession that SEC data does not contain is caught", async () => {
    const p = await goodPanel();
    const a = p.assumptions.find((x) => x.key === "revenue_base");
    const ev = a?.evidenceId ? p.evidence[a.evidenceId] : undefined;
    if (!a || !ev) throw new Error("fixture lacks revenue evidence");
    const fakeId = ev.id.replace(/-\d{2}-\d{6}/, "-99-999999");
    p.evidence = {
      ...p.evidence,
      [fakeId]: {
        ...ev,
        id: fakeId,
        accession: ev.accession?.replace(/-\d{2}-\d{6}$/, "-99-999999") ?? null,
      },
    };
    p.assumptions = p.assumptions.map((x) => (x.key === "revenue_base" ? { ...x, evidenceId: fakeId } : x));
    const r = await run(p);
    const d = errors(r).find((x) => x.type === "citation_mismatch");
    expect(d?.ownerNode).toBe("research");
  });

  test("fake citation: a missing evidence entry is caught", async () => {
    const p = await goodPanel();
    p.assumptions = p.assumptions.map((x) => (x.key === "cash" ? { ...x, evidenceId: "xbrl:nope" } : x));
    expect(errors(await run(p)).some((x) => x.type === "citation_missing")).toBe(true);
  });

  test("period mismatch: a quarterly fact cited for annual revenue is caught", async () => {
    const p = await goodPanel();
    const a = p.assumptions.find((x) => x.key === "revenue_base");
    const ev = a?.evidenceId ? p.evidence[a.evidenceId] : undefined;
    if (!a || !ev) throw new Error("fixture lacks revenue evidence");
    const bad = ev.id.replace(
      /:(\d{4})-\d{2}-\d{2}:(\d{4}-\d{2}-\d{2}):/,
      (_m, y: string, end: string) => `:${y}-10-01:${end}:`,
    );
    p.evidence = { ...p.evidence, [bad]: { ...ev, id: bad } };
    p.assumptions = p.assumptions.map((x) => (x.key === "revenue_base" ? { ...x, evidenceId: bad } : x));
    const r = await run(p);
    expect(errors(r).some((x) => x.type === "period_mismatch")).toBe(true);
  });

  test("a chat message that disagrees with the panel, or carries a number in the commentary, is caught", async () => {
    const p = await goodPanel();
    const text = formatAnalysisMessage(p, []).text;
    const wrong = await run(
      p,
      text.replace(/\d/, (c) => String((Number(c) + 1) % 10)),
    );
    expect(errors(wrong).some((x) => x.subject === "message.facts" && x.ownerNode === "respond")).toBe(true);
    const digits = await run(p, `${text}\n\nRevenue will grow 40% a year.`);
    expect(errors(digits).some((x) => x.subject === "message.commentary")).toBe(true);
  });

  test("integrity: a broken EV-to-equity bridge is caught", async () => {
    const p = await goodPanel();
    p.valuation = { ...p.valuation, equityValue: p.valuation.equityValue * 1.5 };
    expect(errors(await run(p)).length).toBeGreaterThan(0);
  });
});

describe("defect tracking", () => {
  test("a repaired defect is fixed; a repeat after maxRetries is unresolved and kept", async () => {
    const p = await goodPanel();
    p.valuation = { ...p.valuation, perShare: p.valuation.perShare * 2 };
    const first = trackDefects([], (await run(p)).defects, 2);
    expect(first.every((d) => d.status === "open" && d.retries === 0)).toBe(true);
    const second = trackDefects(first, (await run(p)).defects, 2);
    const third = trackDefects(second, (await run(p)).defects, 2);
    expect(third.some((d) => d.status === "unresolved")).toBe(true);
    const fixed = trackDefects(first, [], 2);
    expect(fixed.every((d) => d.status === "fixed")).toBe(true);
    const report = buildReport([], third, 2);
    expect(report.summary.unresolved).toBeGreaterThan(0);
  });
});
