import { growthRate } from "@dealpilot/finance";
import type { Scenario } from "@dealpilot/shared";
import { computePanel, NO_OVERRIDES, type Overrides, recompute } from "../modeling/index.ts";
import type { AnalysisSnapshot } from "../modeling/snapshot.ts";

/** Revenue growth shift applied to every projected year (0.03 = 3 points). */
export const SCENARIO_GROWTH_SHIFT = 0.03;
/** EBIT margin shift applied to every projected year. */
export const SCENARIO_MARGIN_SHIFT = 0.03;
/** Discount-rate shift (0.01 = 1.0 point) added in the bear case and subtracted in the bull case. */
export const SCENARIO_WACC_SHIFT = 0.01;
/** Allowed range of the WACC override (mirrors `OverridesSchema`). */
export const WACC_MIN = 0.03;
export const WACC_MAX = 0.2;
/** The scenario WACC must stay at least this far above terminal growth. */
export const WACC_MIN_SPREAD = 0.01;

interface Shifts {
  revenueGrowthShift: number;
  ebitMarginShift: number;
  waccShift: number;
}

/** Bear: growth −3 pts, margin −3 pts, discount rate +1.0 pt. */
export const BEAR_SHIFTS: Shifts = {
  revenueGrowthShift: -SCENARIO_GROWTH_SHIFT,
  ebitMarginShift: -SCENARIO_MARGIN_SHIFT,
  waccShift: SCENARIO_WACC_SHIFT,
};
/** Bull: growth +3 pts, margin +3 pts, discount rate −1.0 pt. */
export const BULL_SHIFTS: Shifts = {
  revenueGrowthShift: SCENARIO_GROWTH_SHIFT,
  ebitMarginShift: SCENARIO_MARGIN_SHIFT,
  waccShift: -SCENARIO_WACC_SHIFT,
};

const pts = (x: number): string => `${(Math.abs(x) * 100).toFixed(1)} points`;
const sign = (x: number): string => (x < 0 ? "−" : "+");

/**
 * Layer a scenario on top of the snapshot's existing overrides. Growth/margin shifts are ADDED to any shift the
 * user already applied; the WACC is the base panel's WACC ± the shift (clamped), or left alone, with a note.
 */
function scenarioOverrides(
  snapshot: AnalysisSnapshot,
  baseWacc: number,
  terminalGrowth: number,
  s: Shifts,
): { overrides: Overrides; changes: string[] } {
  const prev = snapshot.overrides;
  const changes = [
    `revenue growth ${sign(s.revenueGrowthShift)}${pts(s.revenueGrowthShift)} each year`,
    `EBIT margin ${sign(s.ebitMarginShift)}${pts(s.ebitMarginShift)} each year`,
  ];
  const target = Math.min(WACC_MAX, Math.max(WACC_MIN, baseWacc + s.waccShift));
  const wacc = target >= terminalGrowth + WACC_MIN_SPREAD && target !== baseWacc ? target : null;
  if (wacc === null) {
    changes.push(
      `discount rate unchanged (a ${sign(s.waccShift)}${pts(s.waccShift)} shift is outside the allowed range or too close to terminal growth)`,
    );
  } else {
    changes.push(`discount rate ${sign(s.waccShift)}${pts(s.waccShift)} (WACC ${(wacc * 100).toFixed(2)}%)`);
  }
  return {
    overrides: {
      ...NO_OVERRIDES,
      revenueGrowthShift: (prev.revenueGrowthShift ?? 0) + s.revenueGrowthShift,
      ebitMarginShift: (prev.ebitMarginShift ?? 0) + s.ebitMarginShift,
      wacc,
    },
    changes,
  };
}

function delta(basePerShare: number, perShare: number): number {
  // growthRate throws on a non-positive denominator; a non-positive base has no meaningful ratio.
  return basePerShare > 0 ? growthRate({ previous: basePerShare, current: perShare }).value : 0;
}

/**
 * Bear / base / bull valuations from the deterministic model, in that order. Pure and synchronous: the base case is
 * `computePanel(snapshot)`; bear and bull are `recompute` with fixed override sets layered on the snapshot's own.
 * A scenario that cannot be valued (e.g. final-year FCF ≤ 0) is omitted, never thrown; the base case is always
 * present (if the base itself cannot be valued, `computePanel` throws, as it does everywhere else).
 *
 * deltaVsBase = perShare / base perShare − 1 (0 when the base per-share value is not positive).
 */
export function runScenarios(snapshot: AnalysisSnapshot): Scenario[] {
  const base = computePanel(snapshot);
  const baseWacc = base.valuation.wacc;
  const g = base.valuation.terminalGrowth;
  const basePerShare = base.valuation.perShare;

  const build = (name: "bear" | "bull", shifts: Shifts, description: string): Scenario | null => {
    const { overrides, changes } = scenarioOverrides(snapshot, baseWacc, g, shifts);
    try {
      const { panel } = recompute(snapshot, overrides);
      return {
        name,
        description,
        changes,
        perShare: panel.valuation.perShare,
        enterpriseValue: panel.valuation.enterpriseValue,
        deltaVsBase: delta(basePerShare, panel.valuation.perShare),
      };
    } catch {
      return null;
    }
  };

  const bear = build(
    "bear",
    BEAR_SHIFTS,
    "Slower growth, lower margins and a higher discount rate than the base case.",
  );
  const bull = build(
    "bull",
    BULL_SHIFTS,
    "Faster growth, higher margins and a lower discount rate than the base case.",
  );
  const baseScenario: Scenario = {
    name: "base",
    description: "The model's own assumptions (including any you have changed).",
    changes: [],
    perShare: basePerShare,
    enterpriseValue: base.valuation.enterpriseValue,
    deltaVsBase: 0,
  };
  return [bear, baseScenario, bull].filter((s): s is Scenario => s !== null);
}
