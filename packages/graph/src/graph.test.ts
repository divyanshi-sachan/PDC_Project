import { randomUUID } from "node:crypto";
import type { Candidate } from "@dealpilot/agents";
import { company, fakeEdgar, fakeMarket, fakeModel } from "@dealpilot/agents/testkit";
import type { Db } from "@dealpilot/db";
import { type ChatEvent, ChatEventSchema, type Panel } from "@dealpilot/shared";
import { fakeEmbedder } from "@dealpilot/sources";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, test } from "vitest";
import { buildGraph, type GraphDeps } from "./build.ts";
import { runChatTurn } from "./run.ts";

function setup(repair?: GraphDeps["repair"]) {
  const edgar = fakeEdgar([
    company("TESTCO"),
    company("LOSSCO", { margin: -0.1 }),
    company("PEERA", { scale: 5 }),
    company("PEERB", { scale: 3, margin: 0.3 }),
  ]);
  const market = fakeMarket({
    quotes: {
      TESTCO: { price: 20, marketCap: 2e9 },
      LOSSCO: { price: 5, marketCap: 5e8 },
      PEERA: { price: 50, marketCap: 9e9 },
      PEERB: { price: 30, marketCap: 6e9 },
    },
    peers: ["PEERA", "PEERB"],
  });
  const model = fakeModel({
    routes: [
      { match: "New user message: Value TestCo", out: { type: "analysis", ticker: "TESTCO" } },
      { match: "New user message: Value LossCo", out: { type: "analysis", ticker: "LOSSCO" } },
      { match: "New user message: Value Ghost", out: { type: "analysis", ticker: "GHOST" } },
      { match: "New user message: use a 9% WACC", out: { type: "recompute", changes: { wacc: 0.09 } } },
      {
        match: "New user message: drop PEERA",
        out: { type: "recompute", changes: { excludePeers: ["PEERA"] } },
      },
      {
        match: "New user message: hello",
        out: { type: "other", reply: "Hi! Which company would you like valued?" },
      },
    ],
    peers: ["PEERA", "PEERB", "NOPE"],
  });
  const events: ChatEvent[] = [];
  const emit = async (e: ChatEvent) => void events.push(e);
  const graph = buildGraph(
    {
      llm: model.client,
      db: {} as Db,
      emit,
      edgar: edgar.client,
      market,
      embedder: fakeEmbedder(),
      ...(repair ? { repair } : {}),
    },
    new MemorySaver(),
  );
  const threadId = randomUUID();
  const history: { role: "user" | "assistant"; text: string }[] = [];
  async function say(text: string, tid = threadId) {
    const before = events.length;
    const res = await runChatTurn(
      graph,
      {
        job: { threadId: tid, messageId: randomUUID(), assistantMessageId: randomUUID(), userId: "u1", text },
        assistantMessageId: randomUUID(),
        history,
      },
      emit,
    );
    history.push({ role: "user", text }, { role: "assistant", text: res.text });
    return { res, events: events.slice(before) };
  }
  return { edgar, market, model, events, say };
}

const panelOf = (evs: ChatEvent[]): Panel | undefined =>
  evs.findLast((e): e is Extract<ChatEvent, { type: "panel" }> => e.type === "panel")?.panel;

describe("chat graph", () => {
  test("analysis → panel + cited message; every emitted event matches the shared schema", async () => {
    const s = setup();
    const { res, events } = await s.say("Value TestCo with a DCF and comps");
    for (const e of events) expect(ChatEventSchema.safeParse(e).success).toBe(true);

    const steps = events.filter((e) => e.type === "step").map((e) => `${e.node}:${e.status}`);
    expect(steps).toContain("orchestrator:done");
    expect(steps).toContain("research:done");
    expect(steps).toContain("modeling:done");
    expect(events.at(-1)?.type).toBe("done");
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["panel", "message", "done"]));

    const panel = panelOf(events) as Panel;
    expect(panel.ticker).toBe("TESTCO");
    expect(panel.valuation.perShare).toBeGreaterThan(0);
    expect(panel.comps.peers.map((p) => p.ticker)).toEqual(["PEERA", "PEERB"]);
    expect(res.text).toMatch(/DCF value \*\*\$/);
    expect(res.citations.length).toBeGreaterThan(0);
    // the headline figure in the text is the panel's computed value, formatted by code
    expect(res.text).toContain(`$${panel.valuation.perShare.toFixed(2)}`);
    // commentary carries no digits (enforced by schema), so every figure in the message came from code
    const commentary = res.text.split("\n\n").at(-2) ?? "";
    expect(commentary).not.toMatch(/\d/);
    // the independent verifier ran and passed on the clean path
    expect(panel.verification?.summary.errorsOpen).toBe(0);
    expect(panel.verification?.checks.every((c) => c.passed)).toBe(true);
    expect(res.text).toMatch(/Independent verification: 4 of 4 checks passed\./);
    expect(panel.scenarios.map((x) => x.name)).toEqual(["bear", "base", "bull"]);
  });

  test("a follow-up recomputes from the stored snapshot: no SEC calls, no market calls, only the routing model call", async () => {
    const s = setup();
    const first = await s.say("Value TestCo with a DCF and comps");
    const base = panelOf(first.events) as Panel;
    const facts = s.edgar.calls.facts;
    const quotes = s.market.calls.quote;
    const llmCalls = s.model.calls.length;

    const second = await s.say("use a 9% WACC");
    const p2 = panelOf(second.events) as Panel;
    expect(p2.valuation.wacc).toBe(0.09);
    expect(p2.valuation.perShare).not.toBe(base.valuation.perShare);
    expect(second.res.text).toMatch(/Applied: WACC = 9%/);
    expect(s.edgar.calls.facts).toBe(facts);
    expect(s.market.calls.quote).toBe(quotes);
    expect(s.model.calls.slice(llmCalls).map((c) => c.node)).toEqual(["orchestrator.route"]);

    // overrides accumulate across turns
    const third = await s.say("drop PEERA");
    const p3 = panelOf(third.events) as Panel;
    expect(p3.valuation.wacc).toBe(0.09);
    expect(p3.comps.peers.find((p) => p.ticker === "PEERA")?.included).toBe(false);
  });

  test("small talk gets a reply with no panel; a recompute with no prior analysis asks which company", async () => {
    const s = setup();
    const hi = await s.say("hello there");
    expect(hi.res.text).toMatch(/Which company/);
    expect(panelOf(hi.events)).toBeUndefined();

    const fresh = setup();
    const r = await fresh.say("use a 9% WACC");
    expect(r.res.text).toMatch(/no valuation in this chat yet/i);
    expect(panelOf(r.events)).toBeUndefined();
  });

  test("expected failures become friendly answers, not errors", async () => {
    const s = setup();
    const loss = await s.say("Value LossCo please");
    expect(loss.res.text).toMatch(/couldn't value LOSSCO.*negative average operating margin/);
    expect(loss.events.some((e) => e.type === "error")).toBe(false);
    expect(loss.events.at(-1)?.type).toBe("done");

    const ghost = await s.say("Value Ghost Inc");
    expect(ghost.res.text).toMatch(/couldn't find .*GHOST/i);
  });

  test("an unexpected error is emitted as an error event and rethrown", async () => {
    const s = setup();
    await expect(s.say("this message matches no fake route")).rejects.toThrow();
    expect(s.events.some((e) => e.type === "error")).toBe(true);
    expect(s.events.at(-1)?.type).toBe("done");
  });

  describe("error injection: the verifier catches it, routes it to the owner and the final deliverable is correct", () => {
    const quarterly = (c: Candidate): Candidate => {
      const a = c.panel.assumptions.find((x) => x.key === "revenue_base");
      const ev = a?.evidenceId ? c.panel.evidence[a.evidenceId] : undefined;
      if (!a || !ev) return c;
      const id = ev.id.replace(/:(\d{4})-\d{2}-\d{2}:/, (_m, y: string) => `:${y}-10-01:`);
      return {
        ...c,
        panel: {
          ...c.panel,
          evidence: { ...c.panel.evidence, [id]: { ...ev, id } },
          assumptions: c.panel.assumptions.map((x) =>
            x.key === "revenue_base" ? { ...x, evidenceId: id } : x,
          ),
        },
      };
    };
    const cases: [string, (c: Candidate) => Candidate, string, string][] = [
      [
        "wrong number",
        (c) => ({
          ...c,
          panel: {
            ...c.panel,
            valuation: { ...c.panel.valuation, perShare: c.panel.valuation.perShare * 1.1 },
          },
        }),
        "calc_mismatch",
        "modeling",
      ],
      [
        "fake citation",
        (c) => ({
          ...c,
          panel: {
            ...c.panel,
            assumptions: c.panel.assumptions.map((x) =>
              x.key === "cash" ? { ...x, evidenceId: "xbrl:fake" } : x,
            ),
          },
        }),
        "citation_missing",
        "research",
      ],
      ["period mismatch", quarterly, "period_mismatch", "research"],
      [
        "message disagrees with panel",
        (c) => ({ ...c, text: c.text.replace("DCF value", "DCF worth") }),
        "inconsistency",
        "respond",
      ],
    ];

    test.each(cases)("%s is caught and corrected", async (_name, corrupt, type, owner) => {
      const clean = panelOf((await setup().say("Value TestCo with a DCF and comps")).events) as Panel;
      const s = setup({ inject: (c, attempt) => (attempt === 0 ? corrupt(c) : c) });
      const { res, events } = await s.say("Value TestCo with a DCF and comps");
      const panel = panelOf(events) as Panel;
      const found = panel.verification?.defects.find((d) => d.type === type);
      expect(found?.ownerNode).toBe(owner);
      expect(found?.status).toBe("fixed");
      expect(panel.verification?.repairRounds).toBe(1);
      expect(panel.verification?.summary.errorsOpen).toBe(0);
      expect(panel.valuation.perShare).toBeCloseTo(clean.valuation.perShare, 9);
      expect(res.text).toMatch(/found and corrected/);
      expect(res.text).not.toMatch(/UNRESOLVED/);
      expect(events.some((e) => e.type === "step" && e.node === "repair")).toBe(true);
    });

    test("a defect that cannot be repaired is surfaced as unresolved, never hidden", async () => {
      const s = setup({
        inject: (c) => ({
          ...c,
          panel: {
            ...c.panel,
            valuation: { ...c.panel.valuation, perShare: c.panel.valuation.perShare * 2 },
          },
        }),
      });
      const { res, events } = await s.say("Value TestCo with a DCF and comps");
      const panel = panelOf(events) as Panel;
      expect(panel.verification?.summary.unresolved).toBeGreaterThan(0);
      expect(panel.verification?.repairRounds).toBe(2);
      expect(res.text).toMatch(/UNRESOLVED/);
    });
  });
});
