import { describe, expect, test } from "vitest";
import { reciprocalRankFusion } from "./search.ts";

describe("reciprocalRankFusion", () => {
  test("hand-computed scores (k=60)", () => {
    // a: 1/(60+1) + 1/(60+2) = 0.016393 + 0.016129 = 0.032522
    // b: 1/(60+2)            = 0.016129
    // c: 1/(60+1)            = 0.016393
    const fused = reciprocalRankFusion([{ ids: ["a", "b"] }, { ids: ["c", "a"] }]);
    expect(fused.map((f) => f.id)).toEqual(["a", "c", "b"]);
    expect(fused[0]?.score).toBeCloseTo(1 / 61 + 1 / 62, 12);
    expect(fused[0]?.ranks).toEqual([1, 2]);
    expect(fused[2]?.ranks).toEqual([2, null]);
  });

  test("a doc found by both retrievers beats one found by a single retriever at the same rank", () => {
    const fused = reciprocalRankFusion([{ ids: ["x", "y"] }, { ids: ["y"] }]);
    expect(fused[0]?.id).toBe("y");
  });

  test("empty rankings", () => {
    expect(reciprocalRankFusion([{ ids: [] }, { ids: [] }])).toEqual([]);
  });
});
