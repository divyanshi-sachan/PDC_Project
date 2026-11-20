import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { chunkText } from "./chunking.ts";

const para = (n: number, word = "revenue") => Array.from({ length: n }, () => word).join(" ");

describe("chunkText", () => {
  test("short text is a single chunk with exact offsets", () => {
    const text = "Item 7. Management's Discussion.\n\nNet sales increased 2%.";
    const [c, ...rest] = chunkText(text);
    expect(rest).toHaveLength(0);
    expect(c?.charStart).toBe(0);
    expect(c?.text).toBe(text);
  });

  test("respects maxTokens and keeps paragraphs whole", () => {
    const text = [para(300), para(300), para(300)].join("\n\n"); // ~2400 chars per para
    const chunks = chunkText(text, { maxTokens: 700, overlapTokens: 0 });
    expect(chunks.length).toBe(3);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(700 * 4);
  });

  test("oversized paragraphs are split", () => {
    const text = `${para(2000)}.`;
    const chunks = chunkText(text, { maxTokens: 256, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(256 * 4);
  });

  test("property: every chunk is an exact slice and the whole text is covered", () => {
    const arbText = fc
      .array(fc.stringMatching(/^[A-Za-z .,]{1,400}$/), { minLength: 1, maxLength: 30 })
      .map((ps) => ps.join("\n\n"));
    fc.assert(
      fc.property(arbText, fc.integer({ min: 16, max: 300 }), (text, maxTokens) => {
        const chunks = chunkText(text, { maxTokens, overlapTokens: Math.floor(maxTokens / 8) });
        for (const c of chunks) {
          expect(text.slice(c.charStart, c.charEnd)).toBe(c.text);
          expect(c.text.length).toBeLessThanOrEqual(maxTokens * 4);
        }
        // Coverage: every non-whitespace char is inside some chunk.
        const covered = new Uint8Array(text.length);
        for (const c of chunks) covered.fill(1, c.charStart, c.charEnd);
        for (let i = 0; i < text.length; i++) {
          if (!/\s/.test(text[i] as string)) expect(covered[i]).toBe(1);
        }
        // Ordinals are 0..n-1 and starts are strictly increasing (no loops).
        chunks.forEach((c, i) => {
          expect(c.ordinal).toBe(i);
          if (i > 0) expect(c.charStart).toBeGreaterThan((chunks[i - 1] as typeof c).charStart);
        });
      }),
      { numRuns: 200 },
    );
  });
});
