/** Test fixture: a full verified panel from the offline testkit. */
import {
  assemblePanel,
  buildSnapshot,
  composeMessage,
  computePanel,
  verifyAndRepair,
} from "@dealpilot/agents";
import { company, fakeEdgar, fakeMarket, fakeModel } from "@dealpilot/agents/testkit";
import type { Panel } from "@dealpilot/shared";

export async function samplePanel(opts: { verify?: boolean } = {}): Promise<Panel> {
  const edgar = fakeEdgar([
    company("TESTCO"),
    company("PEERA", { scale: 5 }),
    company("PEERB", { scale: 3, margin: 0.3 }),
  ]).client;
  const snapshot = await buildSnapshot(
    {
      llm: fakeModel({ routes: [], peers: ["PEERA", "PEERB"] }).client,
      edgar,
      market: fakeMarket({
        quotes: {
          TESTCO: { price: 20, marketCap: 2e9 },
          PEERA: { price: 50, marketCap: 9e9 },
          PEERB: { price: 30, marketCap: 6e9 },
        },
        beta: 1.2,
        riskFree: 0.04,
        peers: ["PEERA", "PEERB"],
      }),
      now: () => new Date("2026-11-21T00:00:00Z"),
    },
    "TESTCO",
  );
  const review = { findings: [], evidence: {} };
  const panel = assemblePanel(snapshot, review);
  if (opts.verify === false) return panel;
  const out = await verifyAndRepair(
    { verifier: { edgar } },
    {
      snapshot,
      candidate: { panel, commentary: null, changes: [], text: composeMessage(panel, [], null) },
      review,
    },
  );
  return out.candidate.panel;
}
export { computePanel };
