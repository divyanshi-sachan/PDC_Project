import { describe, expect, it } from "vitest";
import { FinanceInputError } from "./errors.ts";
import { result } from "./result.ts";
import { expectRelClose, relClose } from "./test-utils.ts";

describe("result", () => {
  it("packs value, unit, formulaId and inputs", () => {
    const r = result("dcf.ufcf", 42, "currency", { ebit: 50 });
    expect(r).toEqual({ value: 42, unit: "currency", formulaId: "dcf.ufcf", inputs: { ebit: 50 } });
  });
  it("allows null and nested finite numbers", () => {
    expect(() => result("x.y", { a: [1, 2], b: null, c: { d: 3 } }, "currency", {})).not.toThrow();
  });
  it("rejects non-finite numbers anywhere in the value", () => {
    expect(() => result("x.y", Number.NaN, "ratio", {})).toThrow(FinanceInputError);
    expect(() => result("x.y", [1, Number.POSITIVE_INFINITY], "ratio", {})).toThrow(FinanceInputError);
    expect(() => result("x.y", { a: { b: [Number.NaN] } }, "ratio", {})).toThrow(/x\.y\.a\.b\[0\]/);
  });
});

describe("relClose", () => {
  it("is relative for large and absolute near zero", () => {
    expect(relClose(1e9, 1e9 + 0.5)).toBe(true); // 0.5 ≤ 1e-9·1e9 = 1
    expect(relClose(1e9, 1e9 + 2)).toBe(false);
    expect(relClose(0, 5e-10)).toBe(true);
    expect(relClose(0, 2e-9)).toBe(false);
    expect(relClose(Number.NaN, Number.NaN)).toBe(false);
    expect(() => expectRelClose(1, 1.1)).toThrow();
  });
});
