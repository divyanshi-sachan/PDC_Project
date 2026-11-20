import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { enterpriseToEquity, equityToEnterprise, perShareValue } from "./bridge.ts";
import { FinanceInputError } from "./errors.ts";
import { relClose } from "./test-utils.ts";

const items = { debt: 300, preferred: 50, minorityInterest: 20, cash: 120, nonOperatingAssets: 30 };

describe("enterpriseToEquity", () => {
  it("hand-computed: 1000 − 300 − 50 − 20 + 120 + 30 = 780", () => {
    const r = enterpriseToEquity({ enterpriseValue: 1000, ...items });
    expect(r.value.equityValue).toBeCloseTo(780, 9);
    expect(r.value.enterpriseValue).toBe(1000);
    expect(r.value.lines.map((l) => [l.item, l.contribution])).toEqual([
      ["debt", -300],
      ["preferred", -50],
      ["minorityInterest", -20],
      ["cash", 120],
      ["nonOperatingAssets", 30],
    ]);
    expect(r.formulaId).toBe("bridge.ev_to_equity");
  });
  it("allows negative equity (distress)", () => {
    // 100 − 300 − 50 − 20 + 120 + 30 = −120
    expect(enterpriseToEquity({ enterpriseValue: 100, ...items }).value.equityValue).toBeCloseTo(-120, 9);
  });
  it("throws on negative items or non-finite EV", () => {
    expect(() => enterpriseToEquity({ enterpriseValue: 1000, ...items, debt: -1 })).toThrow(
      FinanceInputError,
    );
    expect(() => enterpriseToEquity({ enterpriseValue: 1000, ...items, cash: -1 })).toThrow(
      FinanceInputError,
    );
    expect(() => enterpriseToEquity({ enterpriseValue: Number.NaN, ...items })).toThrow(FinanceInputError);
  });
});

describe("equityToEnterprise", () => {
  it("hand-computed: 780 + 300 + 50 + 20 − 120 − 30 = 1000", () => {
    const r = equityToEnterprise({ equityValue: 780, ...items });
    expect(r.value.enterpriseValue).toBeCloseTo(1000, 9);
    expect(r.formulaId).toBe("bridge.equity_to_ev");
  });
  it("throws on negative items", () => {
    expect(() => equityToEnterprise({ equityValue: 780, ...items, preferred: -1 })).toThrow(
      FinanceInputError,
    );
  });
});

describe("perShareValue", () => {
  it("hand-computed: 780 / 104 = 7.5", () => {
    expect(perShareValue({ equityValue: 780, dilutedShares: 104 }).value).toBeCloseTo(7.5, 9);
  });
  it("throws on non-positive shares", () => {
    expect(() => perShareValue({ equityValue: 780, dilutedShares: 0 })).toThrow(FinanceInputError);
  });
});

describe("bridge properties", () => {
  const mag = fc.double({ min: 0, max: 1e9, noNaN: true });
  const arb = fc.record({
    debt: mag,
    preferred: mag,
    minorityInterest: mag,
    cash: mag,
    nonOperatingAssets: mag,
  });

  it("round-trips EV → equity → EV", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e9, max: 1e10, noNaN: true }), arb, (ev, it) => {
        const eq = enterpriseToEquity({ enterpriseValue: ev, ...it }).value.equityValue;
        const back = equityToEnterprise({ equityValue: eq, ...it }).value.enterpriseValue;
        // Tolerance is relative to the largest magnitude in the bridge, since cancellation between
        // large items can leave a small EV with absolute rounding error of a few ulps of those items.
        const scale = Math.max(1, Math.abs(ev), ...Object.values(it));
        expect(Math.abs(back - ev)).toBeLessThanOrEqual(1e-12 * scale);
      }),
    );
  });

  it("is additive: EV + Σ contributions = equity", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e9, max: 1e10, noNaN: true }), arb, (ev, it) => {
        const b = enterpriseToEquity({ enterpriseValue: ev, ...it }).value;
        const sum = b.lines.reduce((acc, l) => acc + l.contribution, b.enterpriseValue);
        expect(relClose(sum, b.equityValue)).toBe(true);
      }),
    );
  });
});
