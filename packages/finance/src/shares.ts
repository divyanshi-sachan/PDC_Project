/**
 * Diluted share count via the treasury stock method (TSM), and the price ↔ dilution circularity solver.
 *
 * Units: share counts in one consistent scale (shares or millions of shares); prices and strikes in
 * currency per share; equity value in currency, scaled consistently with the share count.
 */
import { assertNonNegative, assertPositive, FinanceInputError } from "./errors.ts";
import { type CalcResult, result } from "./result.ts";

/** A dilutive instrument tranche. RSUs / restricted shares are instruments with strike 0. */
export interface DilutiveInstrument {
  /** Optional label (e.g. "2019 options"). */
  label?: string;
  /** Number of underlying shares, ≥ 0. */
  count: number;
  /** Exercise (strike) price per share, ≥ 0. Use 0 for RSUs. */
  strike: number;
}

/** Per-tranche TSM detail. */
export interface TsmTranche {
  label: string | null;
  count: number;
  strike: number;
  inTheMoney: boolean;
  incrementalShares: number;
}

/** Output of {@link treasuryStockMethod}. */
export interface TsmResult {
  basicShares: number;
  incrementalShares: number;
  dilutedShares: number;
  tranches: TsmTranche[];
}

function validateInstruments(instruments: readonly DilutiveInstrument[]): void {
  instruments.forEach((inst, idx) => {
    assertNonNegative(inst.count, `instruments[${idx}].count`);
    assertNonNegative(inst.strike, `instruments[${idx}].strike`);
  });
}

function tsm(basicShares: number, sharePrice: number, instruments: readonly DilutiveInstrument[]): TsmResult {
  const tranches = instruments.map((inst): TsmTranche => {
    const inTheMoney = inst.strike < sharePrice;
    // Shares issued on exercise minus shares repurchased with the exercise proceeds at the current price.
    const incrementalShares = inTheMoney ? inst.count - (inst.count * inst.strike) / sharePrice : 0;
    return {
      label: inst.label ?? null,
      count: inst.count,
      strike: inst.strike,
      inTheMoney,
      incrementalShares,
    };
  });
  const incrementalShares = tranches.reduce((acc, t) => acc + t.incrementalShares, 0);
  return { basicShares, incrementalShares, dilutedShares: basicShares + incrementalShares, tranches };
}

/**
 * Treasury stock method at a given share price:
 *
 *   diluted = basic + Σ_{strike < price} count·(1 − strike / price)
 *
 * Out-of-the-money tranches (strike ≥ price) add nothing. RSUs (strike 0) add their full count.
 * Diluted shares are ≥ basic and nondecreasing in price. Convertibles are not handled here.
 * Units: shares; price and strike in currency per share.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if basicShares or sharePrice ≤ 0; `OUT_OF_RANGE` if a
 *   count or strike < 0.
 */
export function treasuryStockMethod(i: {
  basicShares: number;
  sharePrice: number;
  instruments: readonly DilutiveInstrument[];
}): CalcResult<TsmResult> {
  assertPositive(i.basicShares, "basicShares");
  assertPositive(i.sharePrice, "sharePrice");
  validateInstruments(i.instruments);
  return result("shares.tsm", tsm(i.basicShares, i.sharePrice, i.instruments), "shares", {
    basicShares: i.basicShares,
    sharePrice: i.sharePrice,
    instruments: i.instruments.map((x) => ({ ...x })),
  });
}

/** Output of {@link solveDilutedShares}. */
export interface DilutedSharesSolution extends TsmResult {
  /** Solved price per share: sharePrice · dilutedShares(sharePrice) = equityValue. */
  sharePrice: number;
  /** The strike segment (lower, upper] that contains the solution; upper is `null` for the open top segment. */
  segment: { lower: number; upper: number | null };
}

/**
 * Resolves the TSM circularity when the share price is itself the output of a valuation:
 * P = equityValue / dilutedShares(P).
 *
 * Exact piecewise solve (no iteration). Sort the distinct strikes k₁ < … < kₘ and take the segments
 * (0, k₁], (k₁, k₂], …, (kₘ, ∞). Inside a segment the in-the-money set is fixed (strike < P), and
 * P·D(P) = P·basic + Σ_ITM c·(P − k) = E is linear in P, so
 *
 *   P = (E + Σ_{strike<P} c·k) / (basic + Σ_{strike<P} c)
 *
 * The first segment whose P lies inside it is the answer. RSUs (strike 0) are always in the money.
 * Because P·D(P) is continuous and strictly increasing in P, exactly one segment matches; the result is
 * then re-expressed through {@link treasuryStockMethod} at that price.
 *
 * Units: equityValue in currency (same scale as shares), shares, output price in currency per share.
 * @throws FinanceInputError `NON_POSITIVE_DENOMINATOR` if equityValue or basicShares ≤ 0; `OUT_OF_RANGE` for
 *   a negative count or strike; `NO_CONVERGENCE` if no segment matches (should be impossible; it guards
 *   against floating-point edge cases).
 */
export function solveDilutedShares(i: {
  equityValue: number;
  basicShares: number;
  instruments: readonly DilutiveInstrument[];
}): CalcResult<DilutedSharesSolution> {
  assertPositive(i.equityValue, "equityValue");
  assertPositive(i.basicShares, "basicShares");
  validateInstruments(i.instruments);

  const strikes = [...new Set(i.instruments.map((x) => x.strike))].sort((a, b) => a - b);
  // Segment lower bounds: 0, then each positive strike. In (lower, upper] the ITM set is strike ≤ lower.
  const lowers = [0, ...strikes.filter((k) => k > 0)];
  const slack = 1e-12;
  for (let s = 0; s < lowers.length; s++) {
    const lower = lowers[s] ?? 0;
    const upper = lowers[s + 1] ?? null;
    let proceeds = 0;
    let count = 0;
    for (const inst of i.instruments) {
      if (inst.strike <= lower) {
        proceeds += inst.count * inst.strike;
        count += inst.count;
      }
    }
    const price = (i.equityValue + proceeds) / (i.basicShares + count);
    const aboveLower = price > lower * (1 - slack);
    const belowUpper = upper === null || price <= upper * (1 + slack);
    if (aboveLower && belowUpper) {
      const final = tsm(i.basicShares, price, i.instruments);
      return result(
        "shares.solve_diluted",
        { ...final, sharePrice: price, segment: { lower, upper } },
        "shares",
        {
          equityValue: i.equityValue,
          basicShares: i.basicShares,
          instruments: i.instruments.map((x) => ({ ...x })),
        },
      );
    }
  }
  throw new FinanceInputError(
    "NO_CONVERGENCE",
    "solveDilutedShares found no strike segment containing the price",
  );
}
