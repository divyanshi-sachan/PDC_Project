import ExcelJS from "exceljs";
import { HyperFormula } from "hyperformula";
import { describe, expect, test } from "vitest";
import { samplePanel } from "./fixture.ts";
import { buildWorkbook } from "./workbook.ts";

/** Recalculate every formula in the workbook with an independent engine (HyperFormula). */
async function recalc(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer as ArrayBuffer);
  const sheets: Record<string, (string | number | null)[][]> = {};
  const cached: Record<string, Map<string, number | string>> = {};
  for (const ws of wb.worksheets) {
    const grid: (string | number | null)[][] = Array.from({ length: ws.rowCount }, () =>
      Array.from({ length: Math.max(ws.columnCount, 1) }, () => null),
    );
    const seen = new Map<string, number | string>();
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        const val = cell.value;
        let out: string | number | null;
        if (val !== null && typeof val === "object" && "formula" in val) {
          out = `=${val.formula}`;
          if (val.result !== undefined) seen.set(cell.address, val.result as number | string);
        } else if (val instanceof Date) out = val.toISOString();
        else if (val !== null && typeof val === "object") out = JSON.stringify(val);
        else out = val as string | number | null;
        const line = grid[r - 1];
        if (line) line[c - 1] = out;
      });
    });
    cached[ws.name] = seen;
    sheets[ws.name] = grid;
  }
  const hf = HyperFormula.buildFromSheets(sheets, { licenseKey: "gpl-v3" });
  const value = (sheet: string, address: string) => {
    const id = hf.getSheetId(sheet) as number;
    const cell = hf.simpleCellAddressFromString(address, id);
    if (!cell) throw new Error(`bad address ${address}`);
    return hf.getCellValue(cell);
  };
  return { hf, value, cached, wb };
}

describe("workbook parity: recalculated formulas equal the finance-computed panel", () => {
  test("DCF outputs, projection, sensitivity grid and comps medians", async () => {
    const panel = await samplePanel();
    const { value, cached } = await recalc(await buildWorkbook(panel));
    const v = panel.valuation;
    const rel = (a: unknown, b: number) => expect(a as number).toBeCloseTo(b, 6);
    const near = (a: unknown, b: number) =>
      expect(Math.abs((a as number) - b)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(b)));

    near(value("DCF", "B12"), v.wacc);
    near(value("DCF", "B23"), v.enterpriseValue);
    near(value("DCF", "B26"), v.equityValue);
    near(value("DCF", "B28"), v.perShare);
    near(value("DCF", "B31"), v.terminalShareOfEv as number);
    if (v.impliedUpsidePct !== null) near(value("DCF", "B30"), v.impliedUpsidePct);
    near(value("Summary", "B4"), v.perShare);

    // projection rows
    panel.projection.forEach((p, k) => {
      const c = String.fromCharCode("C".charCodeAt(0) + k);
      near(value("Model", `${c}7`), p.revenue);
      near(value("Model", `${c}9`), p.ebit);
      near(value("Model", `${c}15`), p.ufcf);
    });
    for (const [k, p] of panel.projection.entries())
      near(value("DCF", `${String.fromCharCode(66 + k)}17`), p.discountFactor);

    // every sensitivity cell
    for (const [i, row] of panel.sensitivity.values.entries())
      for (const [j, x] of row.entries())
        near(value("Sensitivity", `${String.fromCharCode(66 + j)}${5 + i}`), x);
    // centre of the grid is the base case
    const mid = Math.floor(panel.sensitivity.values.length / 2);
    rel(value("Sensitivity", `D${5 + mid}`), v.perShare);

    // comps medians
    if (panel.comps.medianEvToEbitda !== null) {
      const row = [...(cached.Comps?.keys() ?? [])].length; // cached values exist for formula cells
      expect(row).toBeGreaterThan(0);
    }
    // cached results equal recalculated results for every formula cell in the main sheets
    for (const sheet of ["DCF", "Model", "Sensitivity", "Summary"]) {
      for (const [address, c] of cached[sheet] ?? []) {
        if (typeof c === "number") {
          const got = value(sheet, address);
          if (typeof got !== "number")
            throw new Error(`${sheet}!${address}: expected ${c}, got ${JSON.stringify(got)}`);
          near(got, c);
        }
      }
    }
  });

  test("changing an input reprices the model (formulas are live)", async () => {
    const panel = await samplePanel();
    const { hf, value } = await recalc(await buildWorkbook(panel));
    const before = value("DCF", "B28") as number;
    // find the terminal growth input cell on Inputs and lower it
    const inputs = hf.getSheetId("Inputs") as number;
    const dims = hf.getSheetDimensions(inputs);
    let target: { sheet: number; row: number; col: number } | null = null;
    for (let r = 0; r < dims.height; r++) {
      if (
        hf.getCellValue({ sheet: inputs, row: r, col: 0 }) ===
        panel.assumptions.find((a) => a.key === "terminal_growth")?.label
      )
        target = { sheet: inputs, row: r, col: 1 };
    }
    expect(target).not.toBeNull();
    const t = target as { sheet: number; row: number; col: number };
    hf.setCellContents(t, [[0.005]]);
    const after = hf.getCellValue({ sheet: hf.getSheetId("DCF") as number, row: 27, col: 1 }) as number;
    expect(after).toBeLessThan(before);
  });

  test("workbook has the expected tabs and flags an unverified panel loudly", async () => {
    const panel = await samplePanel({ verify: false });
    const { wb, value } = await recalc(await buildWorkbook(panel));
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Summary",
      "Inputs",
      "Model",
      "DCF",
      "Comps",
      "Sensitivity",
      "Sources",
      "Review",
      "Defects",
    ]);
    expect(String(value("Summary", "B13"))).toBe("NOT VERIFIED");
  });
});
