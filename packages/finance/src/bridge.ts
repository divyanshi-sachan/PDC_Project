/**
 * Enterprise value ↔ equity value bridge and per-share value.
 *
 * Sign convention: every bridge item is passed as a non-negative **magnitude** (debt of 200 is 200); the
 * bridge applies the sign. All items must be as of the same balance-sheet date as the valuation and in the
 * same currency/scale as the enterprise value.
 */
import { assertFinite, assertNonNegative, assertPositive } from "./errors.ts";
import { type CalcResult, result } from "./result.ts";

/** The claims and non-operating items between enterprise value and equity value. All ≥ 0. */
export interface BridgeItems {
  /** Total debt (incl. leases if the EV treats them as debt). */
  debt: number;
  /** Preferred equity. */
  preferred: number;
  /** Minority (non-controlling) interest. */
  minorityInterest: number;
  /** Cash and cash equivalents. */
  cash: number;
  /** Non-operating assets (e.g. equity investments) excluded from the operating EV. */
  nonOperatingAssets: number;
}

/** One line of an itemised bridge; `contribution` is signed (+ adds to equity, − subtracts). */
export interface BridgeLine {
  item: keyof BridgeItems;
  contribution: number;
}

/** Itemised bridge: enterpriseValue + Σ contributions = equityValue. */
export interface Bridge {
  enterpriseValue: number;
  lines: BridgeLine[];
  equityValue: number;
}

function validateItems(items: BridgeItems): void {
  assertNonNegative(items.debt, "debt");
  assertNonNegative(items.preferred, "preferred");
  assertNonNegative(items.minorityInterest, "minorityInterest");
  assertNonNegative(items.cash, "cash");
  assertNonNegative(items.nonOperatingAssets, "nonOperatingAssets");
}

function lines(items: BridgeItems): BridgeLine[] {
  return [
    { item: "debt", contribution: -items.debt },
    { item: "preferred", contribution: -items.preferred },
    { item: "minorityInterest", contribution: -items.minorityInterest },
    { item: "cash", contribution: items.cash },
    { item: "nonOperatingAssets", contribution: items.nonOperatingAssets },
  ];
}

function pickItems(i: BridgeItems): BridgeItems {
  return {
    debt: i.debt,
    preferred: i.preferred,
    minorityInterest: i.minorityInterest,
    cash: i.cash,
    nonOperatingAssets: i.nonOperatingAssets,
  };
}

/**
 * EV → equity: equity = EV − debt − preferred − minorityInterest + cash + nonOperatingAssets.
 *
 * Units: currency. EV may be any finite value; the resulting equity may be negative (distress) and is
 * returned as is. Returns the itemised bridge.
 * @throws FinanceInputError `OUT_OF_RANGE` if any item < 0; `NON_FINITE` on non-finite input.
 */
export function enterpriseToEquity(i: { enterpriseValue: number } & BridgeItems): CalcResult<Bridge> {
  assertFinite(i.enterpriseValue, "enterpriseValue");
  const items = pickItems(i);
  validateItems(items);
  const bridgeLines = lines(items);
  const equityValue = bridgeLines.reduce((acc, l) => acc + l.contribution, i.enterpriseValue);
  return result(
    "bridge.ev_to_equity",
    { enterpriseValue: i.enterpriseValue, lines: bridgeLines, equityValue },
    "currency",
    { enterpriseValue: i.enterpriseValue, ...items },
  );
}

/**
 * Equity → EV (inverse of {@link enterpriseToEquity}):
 * EV = equity + debt + preferred + minorityInterest − cash − nonOperatingAssets.
 *
 * Units: currency. Returns the same itemised bridge (lines signed as in the EV → equity direction, so
 * enterpriseValue + Σ contributions = equityValue still holds).
 * @throws FinanceInputError `OUT_OF_RANGE` if any item < 0; `NON_FINITE` on non-finite input.
 */
export function equityToEnterprise(i: { equityValue: number } & BridgeItems): CalcResult<Bridge> {
  assertFinite(i.equityValue, "equityValue");
  const items = pickItems(i);
  validateItems(items);
  const bridgeLines = lines(items);
  const enterpriseValue = bridgeLines.reduce((acc, l) => acc - l.contribution, i.equityValue);
  return result(
    "bridge.equity_to_ev",
    { enterpriseValue, lines: bridgeLines, equityValue: i.equityValue },
    "currency",
    { equityValue: i.equityValue, ...items },
  );
}

/**
 * Value per share = equityValue / dilutedShares.
 *
 * Units: currency and shares in the same scale (e.g. USD and shares, not USD and millions of shares);
 * output `currency_per_share`. Use diluted shares from {@link solveDilutedShares}.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if dilutedShares ≤ 0.
 */
export function perShareValue(i: { equityValue: number; dilutedShares: number }): CalcResult<number> {
  assertFinite(i.equityValue, "equityValue");
  assertPositive(i.dilutedShares, "dilutedShares");
  return result("bridge.per_share", i.equityValue / i.dilutedShares, "currency_per_share", { ...i });
}
