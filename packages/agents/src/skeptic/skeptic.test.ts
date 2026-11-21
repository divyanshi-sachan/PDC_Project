import { fakeLlm } from "@dealpilot/llm";
import type { Finding, Panel } from "@dealpilot/shared";
import { describe, expect, test } from "vitest";
import { buildSnapshot, computePanel, NO_OVERRIDES, recompute } from "../modeling/index.ts";
import type { AnalysisSnapshot } from "../modeling/snapshot.ts";
import { company, fakeEdgar, fakeMarket, fakeModel } from "../testkit.ts";
import { runScenarios, runSkeptic } from "./index.ts";

async function snapshotFor(margin?: number): Promise<AnalysisSnapshot> {
  return buildSnapshot(
    {
      llm: fakeModel({ routes: [], peers: [] }).client,
      edgar: fakeEdgar([company("TESTCO", margin === undefined ? {} : { margin })]).client,
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
}

describe("runScenarios", () => {
  test("ordered bear < base < bull; base equals computePanel exactly; base delta is 0", async () => {
    const snap = await snapshotFor();
    const s = runScenarios(snap);
    expect(s.map((x) => x.name)).toEqual(["bear", "base", "bull"]);
    const [bear, base, bull] = s as [(typeof s)[0], (typeof s)[0], (typeof s)[0]];
    expect(bear.perShare).toBeLessThan(base.perShare);
    expect(base.perShare).toBeLessThan(bull.perShare);
    expect(bear.enterpriseValue).toBeLessThan(base.enterpriseValue);
    expect(base.perShare).toBe(computePanel(snap).valuation.perShare);
    expect(base.deltaVsBase).toBe(0);
    expect(bear.deltaVsBase).toBeCloseTo(bear.perShare / base.perShare - 1, 12);
    expect(bear.deltaVsBase).toBeLessThan(0);
    expect(bull.deltaVsBase).toBeGreaterThan(0);
    for (const x of [bear, bull]) {
      const text = x.changes.join(" ").toLowerCase();
      expect(text).toMatch(/growth/);
      expect(text).toMatch(/margin/);
      expect(text).toMatch(/discount rate/);
    }
    expect(bear.changes.join(" ")).toMatch(/−3\.0 points/);
    expect(bull.changes.join(" ")).toMatch(/\+3\.0 points.*−1\.0 points/);
  });

  test("bear/bull WACC is base WACC ± 1 point", async () => {
    const snap = await snapshotFor();
    const baseWacc = computePanel(snap).valuation.wacc;
    const s = runScenarios(snap);
    expect(s[0]?.changes.join(" ")).toContain(`WACC ${((baseWacc + 0.01) * 100).toFixed(2)}%`);
    expect(s[2]?.changes.join(" ")).toContain(`WACC ${((baseWacc - 0.01) * 100).toFixed(2)}%`);
  });

  test("a user WACC override is respected and layered, not reset; snapshot is not mutated", async () => {
    const snap = (await snapshotFor()) as AnalysisSnapshot;
    const user = recompute(snap, { ...NO_OVERRIDES, wacc: 0.09, revenueGrowthShift: 0.01 }).snapshot;
    const frozen = JSON.stringify(user);
    const s = runScenarios(user);
    expect(JSON.stringify(user)).toBe(frozen);
    const base = computePanel(user);
    expect(base.valuation.wacc).toBe(0.09);
    expect(s.find((x) => x.name === "base")?.perShare).toBe(base.valuation.perShare);
    const bear = s.find((x) => x.name === "bear");
    expect(bear?.changes.join(" ")).toContain("WACC 10.00%");
    // equals recomputing with the user's shift plus the scenario shift
    const expected = recompute(user, {
      ...NO_OVERRIDES,
      wacc: 0.1,
      revenueGrowthShift: 0.01 - 0.03,
      ebitMarginShift: -0.03,
    }).panel.valuation.perShare;
    expect(bear?.perShare).toBeCloseTo(expected, 9);
  });

  test("a WACC that would sit too close to terminal growth is left unchanged and noted", async () => {
    const snap = await snapshotFor();
    const g = computePanel(snap).valuation.terminalGrowth;
    const tight = recompute(snap, { ...NO_OVERRIDES, wacc: g + 0.015 }).snapshot; // bull would be g + 0.005
    const bull = runScenarios(tight).find((x) => x.name === "bull");
    expect(bull?.changes.join(" ")).toMatch(/discount rate unchanged/);
  });

  test("an unvaluable bear case is omitted and the base case remains", async () => {
    const snap = await snapshotFor(0.04);
    const s = runScenarios(snap);
    expect(s.map((x) => x.name)).not.toContain("bear");
    expect(s.map((x) => x.name)).toContain("base");
  });
});

async function panelFor(): Promise<Panel> {
  return computePanel(await snapshotFor());
}

const good = (panel: Panel) => {
  const keyed = panel.assumptions.find((a) => a.evidenceId !== null && panel.evidence[a.evidenceId]);
  return {
    key: keyed?.key as string,
    evidenceId: keyed?.evidenceId as string,
    out: {
      challenges: [
        {
          assumptionKey: keyed?.key,
          title: "Base year may not be representative",
          argument: "The starting point could be a peak, which would overstate everything that follows.",
          severity: "high",
        },
        {
          assumptionKey: "wacc",
          title: "Discount rate looks generous",
          argument: "A lower cost of capital lifts the value of distant cash flows disproportionately.",
          severity: "medium",
        },
      ],
    },
  };
};

describe("runSkeptic", () => {
  test("valid challenges become findings with ids, basis and evidence", async () => {
    const panel = await panelFor();
    const g = good(panel);
    const m = fakeLlm(() => g.out);
    const out = await runSkeptic(
      { llm: m.client },
      { panel, scenarios: runScenarios(await snapshotFor()), findings: [] },
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      id: `skeptic:${g.key}`,
      agent: "skeptic",
      severity: "high",
      basis: g.key,
      evidenceIds: [g.evidenceId],
    });
    expect(out[1]).toMatchObject({ id: "skeptic:wacc", basis: "wacc", evidenceIds: [] });
    expect(m.calls[0]).toMatchObject({ node: "skeptic.challenge", group: "dp-verifier" });
    expect(m.calls[0]?.user).toContain("Scenarios");
    expect(m.calls[0]?.system.length).toBeGreaterThan(100);
  });

  test.each([
    [
      "a digit in the argument",
      (o: Record<string, string>) => ({ ...o, argument: "Growth of 5% is too high here." }),
    ],
    ["a digit in the title", (o: Record<string, string>) => ({ ...o, title: "Year 1 growth is aggressive" })],
    ["an unknown assumptionKey", (o: Record<string, string>) => ({ ...o, assumptionKey: "made_up_key" })],
  ])("rejects %s with the unavailable finding", async (_n, mutate) => {
    const panel = await panelFor();
    const g = good(panel);
    const bad = { challenges: [mutate(g.out.challenges[1] as Record<string, string>)] };
    const out = await runSkeptic({ llm: fakeLlm(() => bad).client }, { panel, scenarios: [], findings: [] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "skeptic:unavailable",
      severity: "low",
      title: "Skeptic review unavailable",
    });
  });

  test("rejects duplicate keys", async () => {
    const panel = await panelFor();
    const c = good(panel).out.challenges[1];
    const out = await runSkeptic(
      { llm: fakeLlm(() => ({ challenges: [c, c] })).client },
      { panel, scenarios: [], findings: [] },
    );
    expect(out.map((f: Finding) => f.id)).toEqual(["skeptic:unavailable"]);
  });

  test("does not call the model for a panel with no assumptions", async () => {
    const panel = { ...(await panelFor()), assumptions: [] };
    const m = fakeLlm(() => ({ challenges: [] }));
    expect(await runSkeptic({ llm: m.client }, { panel, scenarios: [], findings: [] })).toEqual([]);
    expect(m.calls).toHaveLength(0);
  });

  test("an LLM error becomes the unavailable finding and never throws", async () => {
    const panel = await panelFor();
    const m = fakeLlm(() => {
      throw new Error("gateway timeout");
    });
    const out = await runSkeptic({ llm: m.client }, { panel, scenarios: [], findings: [] });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("skeptic:unavailable");
    expect(out[0]?.detail).toContain("gateway timeout");
  });
});
