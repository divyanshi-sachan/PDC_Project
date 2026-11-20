---
name: fin-calc
description: Checklist for adding or changing a deterministic financial calculation (ratios, DCF, WACC, terminal value, comps multiples, sensitivity grids) in packages/finance (TypeScript). Use whenever valuation or ratio math is written or modified.
---

# Adding a finance function (`@dealpilot/finance`)

1. **Location**: `packages/finance/src/<area>.ts` (`ratios`, `dcf`, `wacc`, `terminal`, `bridge`, `comps`, `sensitivity`). Re-export from `src/index.ts`.
2. **Pure function**. It has typed inputs and output, and none of the following: I/O, `fetch`, `process.env`, `Date.now()`, `Math.random()`, LLM SDKs, or `@dealpilot/*` imports. The PostToolUse hook and lefthook reject anything that breaks this.
3. **TSDoc must state**:
   - the formula, in plain notation
   - the units of each input and of the output, plus the sign convention (e.g. capex is positive as an outflow)
   - the period convention (LTM / FY / NTM) and the edge cases (zero or negative denominators, g ≥ WACC)
4. **Errors**: throw `FinanceInputError` (with a `code`) on invalid input. Never return `NaN` or `Infinity` silently. Guard every result with `Number.isFinite`.
5. **Output**: return a `CalcResult<T>`, `{ value, unit, formulaId, inputs }`, so the Verifier and the workbook can trace it. `formulaId` must match the workbook formula template that has the same id.
6. **Numbers**: use `number` (IEEE double, the same as Excel). Round only in presentation code, never inside calculations.
7. **Tests** in `packages/finance/src/<area>.test.ts` (Vitest):
   - at least one hand-computed case, with the arithmetic written out in a comment
   - edge cases and the error paths (`expect(() => ...).toThrow(FinanceInputError)`)
   - **fast-check** property tests for monotonicity or invariants (higher WACC → lower EV; the bridge is additive)
   - `toBeCloseTo(x, 9)` or the `relClose(a, b, 1e-9)` helper, never `toBe` on computed floats
8. **Excel parity**: if the workbook renders this calculation as a formula, add a parity test in `packages/deliverables`. It builds the xlsx, recalculates it with LibreOffice headless (CI), and checks that the result matches the TS value.
9. Ask the `finance-reviewer` subagent to review the diff.

## Conventions

- Mid-year discounting is a flag (`midYear: boolean`), off by default, and it is recorded in the workbook.
- Use the standard EV → equity bridge: `equity = EV − debt − preferred − minorityInterest + cash (+ nonOperatingAssets)`. Every item is an explicit field.
- Diluted shares come from the treasury stock method using the current price. Note any circularity, and resolve it iteratively with a tolerance and a cap on iterations.
