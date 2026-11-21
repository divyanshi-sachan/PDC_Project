import {
  type CalcResult,
  enterpriseToEquity,
  equityToEnterprise,
  evToEbitda,
  evToRevenue,
  impliedValuationRange,
  peerMultipleStats,
  perShareValue,
  priceToEarnings,
} from "@dealpilot/finance";
import type { LlmClient } from "@dealpilot/llm";
import type { PeerRow } from "@dealpilot/shared";
import { z } from "zod";
import { loadPrompt } from "../prompts.ts";
import type { PeerData } from "../research/types.ts";
import type { HistorySummary } from "./summary.ts";

export interface SelectedPeer {
  data: PeerData;
  rationale: string | null;
}

export interface CompsOutput {
  rows: PeerRow[];
  medianEvToEbitda: number | null;
  medianEvToRevenue: number | null;
  impliedPerShare: { low: number; median: number; high: number; basis: string } | null;
  formulaIds: string[];
}

/**
 * Ask the model for US-listed (10-K filing) comparable companies. The provider's peer list is only a hint
 * (it is mostly foreign tickers for large caps); each proposal is validated later against SEC data, so an
 * invented ticker simply fails to load and is skipped.
 */
export async function selectPeers(
  llm: LlmClient,
  ctx: { ticker: string; name: string; sector: string | null; industry: string | null; hints: string[] },
): Promise<{ ticker: string; rationale: string }[]> {
  const self = ctx.ticker.toUpperCase();
  const schema = z.object({
    peers: z
      .array(
        z.object({
          ticker: z.string().regex(/^[A-Z]{1,5}$/, "plain US ticker, 1-5 capital letters"),
          rationale: z.string().max(240),
        }),
      )
      .min(3)
      .max(10)
      .refine((p) => p.every((x) => x.ticker !== self), {
        message: "do not include the target company itself",
      }),
  });
  const { data } = await llm.structured({
    node: "modeling.peers",
    group: "dp-producer",
    system: loadPrompt("peers.v4"),
    messages: [
      {
        role: "user",
        content: `Target: ${ctx.name} (${ctx.ticker}); sector: ${ctx.sector ?? "unknown"}; industry: ${ctx.industry ?? "unknown"}.\nProvider hint list (may be unusable): ${ctx.hints.join(", ") || "none"}`,
      },
    ],
    schema,
    schemaName: "select_peers",
    schemaDescription: "Propose up to 10 US-listed comparable companies, best first.",
    maxTokens: 800,
    temperature: 0.1,
  });
  const seen = new Set<string>();
  return data.peers.filter((p) => {
    if (seen.has(p.ticker)) return false;
    seen.add(p.ticker);
    return true;
  });
}

/**
 * Trading comps: peer multiples → quartile statistics → implied value per share for the target.
 * Uses EV/EBITDA as the primary basis; every multiple comes from `@dealpilot/finance`.
 */
export function runComps(
  peers: SelectedPeer[],
  target: { summary: HistorySummary; ebitda: number | null },
  exclude: ReadonlySet<string> = new Set(),
): CompsOutput {
  const used = new Set<string>();
  const track = <T>(r: CalcResult<T>): T => {
    used.add(r.formulaId);
    return r.value;
  };

  const rows: PeerRow[] = [];
  const included: {
    name: string;
    enterpriseValue: number;
    equityValue: number;
    revenue: number;
    ebitda: number;
    ebit: number;
    netIncome: number;
  }[] = [];

  for (const p of peers) {
    const d = p.data;
    const items = {
      debt: d.totalDebt,
      preferred: 0,
      minorityInterest: 0,
      cash: d.cash,
      nonOperatingAssets: 0,
    };
    const ev = track(equityToEnterprise({ equityValue: d.marketCap, ...items })).enterpriseValue;
    const skip = exclude.has(d.ticker) ? "Excluded by request" : null;
    const safe = <T>(fn: () => CalcResult<T>): T | null => {
      try {
        return track(fn());
      } catch {
        return null; // non-positive denominator: multiple not meaningful
      }
    };
    rows.push({
      ticker: d.ticker,
      name: d.name,
      marketCap: d.marketCap,
      enterpriseValue: ev,
      evToRevenue: safe(() => evToRevenue({ enterpriseValue: ev, revenue: d.revenue })),
      evToEbitda: safe(() => evToEbitda({ enterpriseValue: ev, ebitda: d.ebitda })),
      priceToEarnings: safe(() => priceToEarnings({ equityValue: d.marketCap, netIncome: d.netIncome })),
      included: skip === null,
      excludedReason: skip,
      rationale: p.rationale,
    });
    if (skip === null) {
      included.push({
        name: d.ticker,
        enterpriseValue: ev,
        equityValue: d.marketCap,
        revenue: d.revenue,
        ebitda: d.ebitda,
        ebit: d.ebit,
        netIncome: d.netIncome,
      });
    }
  }

  if (included.length === 0) {
    return {
      rows,
      medianEvToEbitda: null,
      medianEvToRevenue: null,
      impliedPerShare: null,
      formulaIds: [...used].sort(),
    };
  }

  const evEbitda = track(peerMultipleStats(included, "evEbitda"));
  const evRev = track(peerMultipleStats(included, "evRevenue"));
  const medianEvToEbitda = evEbitda.n > 0 ? evEbitda.median : null;
  const medianEvToRevenue = evRev.n > 0 ? evRev.median : null;

  let impliedPerShare: CompsOutput["impliedPerShare"] = null;
  if (evEbitda.n >= 2 && target.ebitda !== null && target.ebitda > 0) {
    const range = track(
      impliedValuationRange({ kind: "evEbitda", targetMetric: target.ebitda, stats: evEbitda }),
    );
    const toShare = (ev: number) => {
      const eq = track(
        enterpriseToEquity({
          enterpriseValue: ev,
          debt: target.summary.totalDebt,
          preferred: 0,
          minorityInterest: 0,
          cash: target.summary.cashAndInvestments,
          nonOperatingAssets: 0,
        }),
      ).equityValue;
      return track(perShareValue({ equityValue: eq, dilutedShares: target.summary.dilutedShares }));
    };
    impliedPerShare = {
      low: toShare(range.low),
      median: toShare(range.mid),
      high: toShare(range.high),
      basis: `EV/EBITDA, peer 25th–75th percentile (n=${evEbitda.n}), latest fiscal year`,
    };
  }

  return { rows, medianEvToEbitda, medianEvToRevenue, impliedPerShare, formulaIds: [...used].sort() };
}
