import { describe, expect, it } from "vitest";
import {
  assertDiscountRate,
  assertFinite,
  assertFiniteArray,
  assertNonNegative,
  assertPositive,
  assertTaxRate,
  FinanceInputError,
} from "./errors.ts";

describe("FinanceInputError", () => {
  it("is an Error with a code and name", () => {
    const e = new FinanceInputError("OUT_OF_RANGE", "bad");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(FinanceInputError);
    expect(e.code).toBe("OUT_OF_RANGE");
    expect(e.name).toBe("FinanceInputError");
    expect(e.message).toBe("bad");
  });
});

describe("assertFinite", () => {
  it("accepts finite numbers including 0 and negatives", () => {
    expect(() => assertFinite(0, "x")).not.toThrow();
    expect(() => assertFinite(-1.5, "x")).not.toThrow();
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("rejects %s", (v) => {
    expect(() => assertFinite(v, "x")).toThrow(FinanceInputError);
    try {
      assertFinite(v, "x");
    } catch (e) {
      expect((e as FinanceInputError).code).toBe("NON_FINITE");
    }
  });
});

describe("other guards", () => {
  it("assertFiniteArray names the index", () => {
    expect(() => assertFiniteArray([1, Number.NaN], "cf")).toThrow(/cf\[1\]/);
    expect(() => assertFiniteArray([1, 2], "cf")).not.toThrow();
  });
  it("assertPositive rejects 0 and negatives", () => {
    expect(() => assertPositive(0, "d")).toThrow(FinanceInputError);
    expect(() => assertPositive(-1, "d")).toThrow(FinanceInputError);
    expect(() => assertPositive(1e-12, "d")).not.toThrow();
  });
  it("assertNonNegative allows 0, rejects negatives", () => {
    expect(() => assertNonNegative(0, "x")).not.toThrow();
    expect(() => assertNonNegative(-0.01, "x")).toThrow(FinanceInputError);
  });
  it("assertTaxRate requires [0, 1]", () => {
    expect(() => assertTaxRate(0)).not.toThrow();
    expect(() => assertTaxRate(1)).not.toThrow();
    expect(() => assertTaxRate(-0.1)).toThrow(FinanceInputError);
    expect(() => assertTaxRate(1.1)).toThrow(FinanceInputError);
  });
  it("assertDiscountRate requires > -1", () => {
    expect(() => assertDiscountRate(-0.5, "r")).not.toThrow();
    expect(() => assertDiscountRate(-1, "r")).toThrow(FinanceInputError);
  });
});
