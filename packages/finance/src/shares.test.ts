import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FinanceInputError } from "./errors.ts";
import { solveDilutedShares, treasuryStockMethod } from "./shares.ts";
import { relClose } from "./test-utils.ts";

describe("treasuryStockMethod", () => {
  it("hand-computed at price 20", () => {
    // Options 10 @ 10: 10 − 10·10/20 = 10 − 5 = 5
    // Options 4 @ 25: out of the money → 0
    // RSUs 3 (strike 0): 3
    // Diluted = 100 + 5 + 0 + 3 = 108
    const r = treasuryStockMethod({
      basicShares: 100,
      sharePrice: 20,
      instruments: [
        { label: "opt A", count: 10, strike: 10 },
        { label: "opt B", count: 4, strike: 25 },
        { label: "rsu", count: 3, strike: 0 },
      ],
    });
    expect(r.value.dilutedShares).toBeCloseTo(108, 9);
    expect(r.value.incrementalShares).toBeCloseTo(8, 9);
    expect(r.value.tranches.map((t) => t.inTheMoney)).toEqual([true, false, true]);
    expect(r.value.tranches[0]?.incrementalShares).toBeCloseTo(5, 9);
    expect(r.unit).toBe("shares");
  });
  it("strike equal to price adds nothing", () => {
    expect(
      treasuryStockMethod({ basicShares: 100, sharePrice: 10, instruments: [{ count: 10, strike: 10 }] })
        .value.dilutedShares,
    ).toBeCloseTo(100, 9);
  });
  it("throws on invalid inputs", () => {
    expect(() => treasuryStockMethod({ basicShares: 0, sharePrice: 10, instruments: [] })).toThrow(
      FinanceInputError,
    );
    expect(() => treasuryStockMethod({ basicShares: 100, sharePrice: 0, instruments: [] })).toThrow(
      FinanceInputError,
    );
    expect(() =>
      treasuryStockMethod({ basicShares: 100, sharePrice: 10, instruments: [{ count: -1, strike: 1 }] }),
    ).toThrow(FinanceInputError);
    expect(() =>
      treasuryStockMethod({ basicShares: 100, sharePrice: 10, instruments: [{ count: 1, strike: -1 }] }),
    ).toThrow(FinanceInputError);
  });

  const instrumentsArb = fc.array(
    fc.record({
      count: fc.double({ min: 0, max: 1e6, noNaN: true }),
      strike: fc.double({ min: 0, max: 200, noNaN: true }),
    }),
    { maxLength: 8 },
  );

  it("property: diluted ≥ basic and nondecreasing in price", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1e8, noNaN: true }),
        instrumentsArb,
        fc.double({ min: 0.01, max: 300, noNaN: true }),
        fc.double({ min: 0, max: 300, noNaN: true }),
        (basic, instruments, p, dp) => {
          const lo = treasuryStockMethod({ basicShares: basic, sharePrice: p, instruments }).value
            .dilutedShares;
          const hi = treasuryStockMethod({ basicShares: basic, sharePrice: p + dp, instruments }).value
            .dilutedShares;
          expect(lo).toBeGreaterThanOrEqual(basic);
          expect(hi).toBeGreaterThanOrEqual(lo - 1e-9 * Math.max(1, lo));
        },
      ),
    );
  });
});

describe("solveDilutedShares", () => {
  it("hand-computed: basic 100, 100 options @ 8, E = 1000 → P = 9", () => {
    // Segment (0, 8]: nothing ITM → P = 1000/100 = 10 > 8, reject.
    // Segment (8, ∞): P = (1000 + 100·8) / (100 + 100) = 1800 / 200 = 9 > 8, accept.
    // Check: D = 100 + 100·(1 − 8/9) = 111.11…; P·D = 9·111.11… = 1000
    const r = solveDilutedShares({
      equityValue: 1000,
      basicShares: 100,
      instruments: [{ count: 100, strike: 8 }],
    });
    expect(r.value.sharePrice).toBeCloseTo(9, 9);
    expect(r.value.dilutedShares).toBeCloseTo(1000 / 9, 9);
    expect(r.value.segment).toEqual({ lower: 8, upper: null });
    expect(r.formulaId).toBe("shares.solve_diluted");
  });
  it("hand-computed: 150 options @ 9 → P = 9.4", () => {
    // (0, 9]: P = 10 > 9, reject. (9, ∞): P = (1000 + 150·9) / (100 + 150) = 2350 / 250 = 9.4
    const r = solveDilutedShares({
      equityValue: 1000,
      basicShares: 100,
      instruments: [{ count: 150, strike: 9 }],
    });
    expect(r.value.sharePrice).toBeCloseTo(9.4, 9);
  });
  it("hand-computed: 1000 options @ 1, E = 200 → P = 1.090909…", () => {
    // (0, 1]: P = 200/100 = 2 > 1, reject. (1, ∞): P = (200 + 1000·1) / (100 + 1000) = 1200 / 1100
    const r = solveDilutedShares({
      equityValue: 200,
      basicShares: 100,
      instruments: [{ count: 1000, strike: 1 }],
    });
    expect(r.value.sharePrice).toBeCloseTo(1200 / 1100, 9);
  });
  it("hand-computed: RSUs always ITM, mixed with an out-of-the-money tranche", () => {
    // Tranches: 10 options @ 5, 10 options @ 20, 5 RSUs; E = 1000, basic 100.
    // (0, 5]: ITM = RSUs → P = 1000 / 105 = 9.52 > 5, reject.
    // (5, 20]: ITM = RSUs + @5 → P = (1000 + 50) / (100 + 5 + 10) = 1050 / 115 = 9.1304…, accept.
    const r = solveDilutedShares({
      equityValue: 1000,
      basicShares: 100,
      instruments: [
        { count: 10, strike: 5 },
        { count: 10, strike: 20 },
        { count: 5, strike: 0 },
      ],
    });
    expect(r.value.sharePrice).toBeCloseTo(1050 / 115, 9);
    expect(r.value.segment).toEqual({ lower: 5, upper: 20 });
    expect(r.value.tranches.map((t) => t.inTheMoney)).toEqual([true, false, true]);
  });
  it("no instruments: diluted = basic", () => {
    const r = solveDilutedShares({ equityValue: 500, basicShares: 50, instruments: [] });
    expect(r.value.dilutedShares).toBeCloseTo(50, 9);
    expect(r.value.sharePrice).toBeCloseTo(10, 9);
    expect(r.value.segment).toEqual({ lower: 0, upper: null });
  });
  it("all options out of the money: P = E / basic", () => {
    // (0, 50]: P = 1000/100 = 10 ≤ 50, accept.
    const r = solveDilutedShares({
      equityValue: 1000,
      basicShares: 100,
      instruments: [{ count: 30, strike: 50 }],
    });
    expect(r.value.sharePrice).toBeCloseTo(10, 9);
    expect(r.value.dilutedShares).toBeCloseTo(100, 9);
  });
  it("throws on invalid parameters", () => {
    const instruments = [{ count: 10, strike: 5 }];
    expect(() => solveDilutedShares({ equityValue: 0, basicShares: 100, instruments })).toThrow(
      FinanceInputError,
    );
    expect(() => solveDilutedShares({ equityValue: 1000, basicShares: 0, instruments })).toThrow(
      FinanceInputError,
    );
    expect(() =>
      solveDilutedShares({ equityValue: 1000, basicShares: 100, instruments: [{ count: -1, strike: 5 }] }),
    ).toThrow(FinanceInputError);
  });
  it("property: P·D(P) = E, with D from treasuryStockMethod at P", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1e7, noNaN: true }),
        fc.double({ min: 1, max: 1e6, noNaN: true }),
        fc.array(
          fc.record({
            count: fc.double({ min: 0, max: 1e6, noNaN: true }),
            strike: fc.double({ min: 0, max: 200, noNaN: true }),
          }),
          { maxLength: 8 },
        ),
        (equity, basic, inst) => {
          const s = solveDilutedShares({ equityValue: equity, basicShares: basic, instruments: inst }).value;
          const d = treasuryStockMethod({
            basicShares: basic,
            sharePrice: s.sharePrice,
            instruments: inst,
          }).value;
          expect(relClose(s.sharePrice * d.dilutedShares, equity, 1e-9)).toBe(true);
          expect(relClose(s.dilutedShares, d.dilutedShares, 1e-9)).toBe(true);
          expect(s.dilutedShares).toBeGreaterThanOrEqual(basic);
        },
      ),
    );
  });
});
