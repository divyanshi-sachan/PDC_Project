/** Cross-output consistency: the chat message must say what the panel says. */
import type { Defect, Panel } from "@dealpilot/shared";
import { formatAnalysisMessage } from "../respond.ts";
import { defect } from "./recompute.ts";

/**
 * `text` is the message as produced for `panel` (before any verification summary is appended): its factual part must
 * be exactly what `formatAnalysisMessage` generates from the panel, and any commentary after it must contain no digits.
 */
export function checkMessageConsistency(
  panel: Panel,
  text: string,
  changes: string[],
): { defects: Defect[]; items: number } {
  const defects: Defect[] = [];
  const expected = formatAnalysisMessage({ ...panel, verification: null }, changes).text;
  let items = 1;
  if (!text.startsWith(expected)) {
    // Locate the first differing line to make the defect actionable.
    const a = expected.split("\n");
    const b = text.split("\n");
    const k = a.findIndex((line, i) => line !== b[i]);
    defects.push(
      defect({
        type: "inconsistency",
        severity: "error",
        ownerNode: "respond",
        subject: "message.facts",
        detail: `The chat message disagrees with the panel${k >= 0 ? ` at line ${k + 1}: expected “${(a[k] ?? "").slice(0, 120)}” but found “${(b[k] ?? "").slice(0, 120)}”` : ""}.`,
        expected: (a[k] ?? "").slice(0, 160),
        actual: (b[k] ?? "").slice(0, 160),
      }),
    );
  } else {
    const commentary = text.slice(expected.length);
    items++;
    if (/\d/.test(commentary)) {
      defects.push(
        defect({
          type: "inconsistency",
          severity: "error",
          ownerNode: "respond",
          subject: "message.commentary",
          detail: "The commentary after the computed figures contains a number that no code produced.",
          expected: "no digits",
          actual: commentary.slice(0, 120),
        }),
      );
    }
  }
  return { defects, items };
}
