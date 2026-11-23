/**
 * Excel workbook with LIVE formulas. Inputs are blue hard-codes with their source; every downstream cell
 * (projection, WACC, DCF, equity bridge, sensitivity grid) is a formula that references them, so changing an
 * input in Excel reprices the model. Each formula cell also carries a cached result computed by
 * `@dealpilot/finance`, and a parity test recalculates the formulas and compares them with the panel.
 *
 * Tabs: Summary · Inputs · Model · DCF · Comps · Sensitivity · Sources · Review · Defects
 */
import type { Assumption, Panel } from "@dealpilot/shared";
import ExcelJS from "exceljs";
import { assumptionValue, derive, readSeries } from "./model.ts";

const BLUE = { argb: "FF0000CC" };
const GREY = { argb: "FF666666" };
const RED = { argb: "FFB00020" };
const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
const WARN_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDECEA" } };

const FMT = {
  pct: "0.00%",
  usd: "#,##0;[Red](#,##0)",
  share: "$#,##0.00",
  mult: '0.0"x"',
  num: "#,##0.00",
  factor: "0.0000",
};
const unitFormat = (u: Assumption["unit"]) =>
  u === "pct"
    ? FMT.pct
    : u === "usd"
      ? FMT.usd
      : u === "multiple"
        ? FMT.mult
        : u === "shares"
          ? "#,##0"
          : FMT.num;

/** Excel column letter for a 1-based index. */
export function col(n: number): string {
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

const title = (ws: ExcelJS.Worksheet, text: string, sub?: string) => {
  ws.getCell("A1").value = text;
  ws.getCell("A1").font = { bold: true, size: 14 };
  if (sub) {
    ws.getCell("A2").value = sub;
    ws.getCell("A2").font = { italic: true, color: GREY };
  }
};
const header = (row: ExcelJS.Row) => {
  row.font = { bold: true };
  row.eachCell((c) => {
    c.fill = HEAD_FILL;
  });
};
/** A formula cell with its cached result. */
const f = (formula: string, result: number | string): ExcelJS.CellFormulaValue => ({ formula, result });

export interface WorkbookOptions {
  generatedAt?: Date;
}

export async function buildWorkbook(panel: Panel, opts: WorkbookOptions = {}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "DealPilot";
  wb.created = opts.generatedAt ?? new Date(panel.asOf);
  wb.calcProperties.fullCalcOnLoad = true;

  const d = derive(panel);
  const { growth, margins } = readSeries(panel);
  const n = growth.length;
  const v = (k: string) => assumptionValue(panel, k);

  const summary = wb.addWorksheet("Summary");
  const inputs = wb.addWorksheet("Inputs");
  const model = wb.addWorksheet("Model");
  const dcf = wb.addWorksheet("DCF");
  const comps = wb.addWorksheet("Comps");
  const sens = wb.addWorksheet("Sensitivity");
  const sources = wb.addWorksheet("Sources");
  const review = wb.addWorksheet("Review");
  const defects = wb.addWorksheet("Defects");

  /* ------------------------------------------------------------------ Inputs */
  title(
    inputs,
    `${panel.companyName} (${panel.ticker}): inputs`,
    "Blue = hard-coded input (from a filing, market data or an explicit assumption). Change them and the model reprices.",
  );
  inputs.addRow([]).commit();
  header(inputs.addRow(["Input", "Value", "Unit", "Source", "Evidence id", "Rationale"]));
  const cellOf = new Map<string, string>();
  for (const a of panel.assumptions) {
    const row = inputs.addRow([a.label, a.value, a.unit, a.source, a.evidenceId ?? "", a.rationale ?? ""]);
    const c = row.getCell(2);
    c.font = { color: BLUE };
    c.numFmt = unitFormat(a.unit);
    cellOf.set(a.key, `Inputs!$B$${row.number}`);
  }
  inputs.columns = [{ width: 44 }, { width: 18 }, { width: 10 }, { width: 12 }, { width: 46 }, { width: 80 }];
  inputs.views = [{ state: "frozen", ySplit: 4 }];
  const ref = (k: string) => {
    const r = cellOf.get(k);
    if (!r) throw new Error(`no input cell for ${k}`);
    return r;
  };

  /* ------------------------------------------------------------------ Model */
  title(model, `${panel.companyName}: projection`, "All figures in USD. Formulas reference the Inputs tab.");
  const first = 3; // column C = year 1
  const lastCol = col(first + n - 1);
  const years = panel.projection.map((p) => p.year);
  const lines = {
    year: 4,
    t: 5,
    growth: 6,
    revenue: 7,
    margin: 8,
    ebit: 9,
    tax: 10,
    nopat: 11,
    da: 12,
    capex: 13,
    nwc: 14,
    ufcf: 15,
  } as const;
  const label = (r: number, text: string, bold = false) => {
    const c = model.getCell(`A${r}`);
    c.value = text;
    if (bold) c.font = { bold: true };
  };
  label(lines.year, "Fiscal year", true);
  label(lines.t, "Period t");
  label(lines.growth, "Revenue growth");
  label(lines.revenue, "Revenue", true);
  label(lines.margin, "EBIT margin");
  label(lines.ebit, "EBIT");
  label(lines.tax, "Taxes on EBIT");
  label(lines.nopat, "NOPAT");
  label(lines.da, "D&A (add back)");
  label(lines.capex, "Capex");
  label(lines.nwc, "Increase in net working capital");
  label(lines.ufcf, "Unlevered free cash flow", true);
  model.getCell(`B${lines.year}`).value = "Base";
  model.getCell(`B${lines.revenue}`).value = f(ref("revenue_base"), v("revenue_base"));
  model.getCell(`B${lines.revenue}`).numFmt = FMT.usd;
  for (let k = 0; k < n; k++) {
    const c = col(first + k);
    const p = k === 0 ? "B" : col(first + k - 1);
    const set = (r: number, val: ExcelJS.CellValue, fmt: string) => {
      const cell = model.getCell(`${c}${r}`);
      cell.value = val;
      cell.numFmt = fmt;
    };
    set(lines.year, years[k] ?? k + 1, "0");
    set(lines.t, k + 1, "0");
    set(lines.growth, f(ref(`revenue_growth_y${k + 1}`), growth[k] as number), FMT.pct);
    set(lines.revenue, f(`${p}${lines.revenue}*(1+${c}${lines.growth})`, d.revenues[k] as number), FMT.usd);
    set(lines.margin, f(ref(`ebit_margin_y${k + 1}`), margins[k] as number), FMT.pct);
    set(lines.ebit, f(`${c}${lines.revenue}*${c}${lines.margin}`, d.ebits[k] as number), FMT.usd);
    set(lines.tax, f(`${c}${lines.ebit}*${ref("tax_rate")}`, d.taxes[k] as number), FMT.usd);
    set(lines.nopat, f(`${c}${lines.ebit}-${c}${lines.tax}`, d.nopat[k] as number), FMT.usd);
    set(lines.da, f(`${c}${lines.revenue}*${ref("da_pct")}`, d.das[k] as number), FMT.usd);
    set(lines.capex, f(`${c}${lines.revenue}*${ref("capex_pct")}`, d.capexes[k] as number), FMT.usd);
    set(
      lines.nwc,
      f(`${ref("nwc_pct")}*(${c}${lines.revenue}-${p}${lines.revenue})`, d.dNwc[k] as number),
      FMT.usd,
    );
    set(
      lines.ufcf,
      f(`${c}${lines.nopat}+${c}${lines.da}-${c}${lines.capex}-${c}${lines.nwc}`, d.fcfs[k] as number),
      FMT.usd,
    );
  }
  model.getRow(lines.year).font = { bold: true };
  model.getRow(lines.ufcf).font = { bold: true };
  model.columns = [{ width: 34 }, ...Array.from({ length: n + 1 }, () => ({ width: 16 }))];
  model.views = [{ state: "frozen", xSplit: 1, ySplit: 5 }];

  /* ------------------------------------------------------------------ DCF */
  const mUfcf = (c: string) => `Model!${c}$${lines.ufcf}`;
  title(dcf, `${panel.companyName}: DCF`, "End-of-year discounting, Gordon-growth terminal value.");
  const hasOverride = cellOf.has("wacc");
  const rows: [string, ExcelJS.CellValue, string][] = [
    ["Risk-free rate (10-year Treasury)", f(ref("risk_free"), v("risk_free")), FMT.pct], // 3
    ["Beta (relevered)", f(ref("beta"), v("beta")), FMT.num], // 4
    ["Equity risk premium", f(ref("erp"), v("erp")), FMT.pct], // 5
    ["Cost of equity (CAPM)", f("B3+B4*B5", d.costOfEquity), FMT.pct], // 6
    ["Pre-tax cost of debt", f(ref("pretax_cost_of_debt"), v("pretax_cost_of_debt")), FMT.pct], // 7
    ["Tax rate", f(ref("tax_rate"), v("tax_rate")), FMT.pct], // 8
    ["Equity value (market cap)", f(ref("market_cap"), v("market_cap")), FMT.usd], // 9
    ["Debt", f(ref("total_debt"), v("total_debt")), FMT.usd], // 10
    ["WACC (computed)", f("B9/(B9+B10)*B6+B10/(B9+B10)*B7*(1-B8)", d.waccComputed), FMT.pct], // 11
    [
      hasOverride ? "WACC used (user override)" : "WACC used",
      f(hasOverride ? ref("wacc") : "B11", hasOverride ? v("wacc") : d.waccComputed),
      FMT.pct,
    ], // 12
    ["Terminal growth", f(ref("terminal_growth"), v("terminal_growth")), FMT.pct], // 13
  ];
  rows.forEach(([text, val, fmt], k) => {
    const r = 3 + k;
    dcf.getCell(`A${r}`).value = text;
    dcf.getCell(`B${r}`).value = val;
    dcf.getCell(`B${r}`).numFmt = fmt;
  });
  const wacc = hasOverride ? v("wacc") : d.waccComputed;
  dcf.getCell("A15").value = "Period t";
  dcf.getCell("A16").value = "Unlevered FCF";
  dcf.getCell("A17").value = "Discount factor";
  dcf.getCell("A18").value = "Present value";
  header(dcf.getRow(15));
  const dfs = panel.projection.map((p) => p.discountFactor);
  let sumPv = 0;
  const pvs: number[] = [];
  for (let k = 0; k < n; k++) {
    const c = col(2 + k); // B.. on the DCF sheet
    const mc = col(first + k);
    dcf.getCell(`${c}15`).value = f(`Model!${mc}${lines.t}`, k + 1);
    dcf.getCell(`${c}16`).value = f(mUfcf(mc), d.fcfs[k] as number);
    dcf.getCell(`${c}16`).numFmt = FMT.usd;
    dcf.getCell(`${c}17`).value = f(`1/(1+$B$12)^${c}15`, dfs[k] as number);
    dcf.getCell(`${c}17`).numFmt = FMT.factor;
    pvs[k] = (d.fcfs[k] as number) * (dfs[k] as number);
    sumPv += pvs[k] as number;
    dcf.getCell(`${c}18`).value = f(`${c}16*${c}17`, pvs[k] as number);
    dcf.getCell(`${c}18`).numFmt = FMT.usd;
  }
  const lc = col(1 + n);
  const v0 = panel.valuation;
  const pvTv = v0.terminalShareOfEv === null ? 0 : v0.terminalShareOfEv * v0.enterpriseValue;
  const tv = ((d.fcfs[n - 1] as number) * (1 + v("terminal_growth"))) / (wacc - v("terminal_growth"));
  const bridge: [string, ExcelJS.CellValue, string][] = [
    ["Sum of PV of free cash flows", f(`SUM(B18:${lc}18)`, sumPv), FMT.usd], // 20
    ["Terminal value (Gordon growth)", f(`${lc}16*(1+B13)/(B12-B13)`, tv), FMT.usd], // 21
    ["PV of terminal value", f(`B21*${lc}17`, pvTv), FMT.usd], // 22
    ["Enterprise value", f("B20+B22", v0.enterpriseValue), FMT.usd], // 23
    ["Less: debt", f(ref("total_debt"), v("total_debt")), FMT.usd], // 24
    ["Plus: cash", f(ref("cash"), v("cash")), FMT.usd], // 25
    ["Equity value", f("B23-B24+B25", v0.equityValue), FMT.usd], // 26
    ["Diluted shares", f(ref("diluted_shares"), v("diluted_shares")), "#,##0"], // 27
    ["DCF value per share", f("B26/B27", v0.perShare), FMT.share], // 28
    ["Market price", panel.price ?? "n/a", FMT.share], // 29
    [
      "Upside vs market price",
      panel.price === null ? "n/a" : f("B28/B29-1", v0.impliedUpsidePct ?? 0),
      FMT.pct,
    ], // 30
    ["Terminal value share of EV", f("B22/B23", v0.terminalShareOfEv ?? 0), FMT.pct], // 31
  ];
  bridge.forEach(([text, val, fmt], k) => {
    const r = 20 + k;
    dcf.getCell(`A${r}`).value = text;
    dcf.getCell(`B${r}`).value = val;
    dcf.getCell(`B${r}`).numFmt = fmt;
  });
  for (const r of [23, 26, 28]) dcf.getRow(r).font = { bold: true };
  dcf.columns = [{ width: 36 }, ...Array.from({ length: n }, () => ({ width: 16 }))];

  /* ------------------------------------------------------------------ Comps */
  title(
    comps,
    `${panel.companyName}: trading comparables`,
    "Peer multiples are computed by the DealPilot finance package from SEC filings and market prices; medians below are live formulas.",
  );
  comps.addRow([]).commit();
  header(
    comps.addRow([
      "Ticker",
      "Company",
      "Market cap",
      "Enterprise value",
      "EV/Revenue",
      "EV/EBITDA",
      "P/E",
      "Included",
      "Why chosen / why excluded",
      "EV/EBITDA used",
      "EV/Revenue used",
    ]),
  );
  const firstPeer = comps.rowCount + 1;
  for (const p of panel.comps.peers) {
    const row = comps.addRow([
      p.ticker,
      p.name,
      p.marketCap,
      p.enterpriseValue,
      p.evToRevenue ?? "",
      p.evToEbitda ?? "",
      p.priceToEarnings ?? "",
      p.included ? "yes" : "no",
      p.included ? (p.rationale ?? "") : (p.excludedReason ?? ""),
    ]);
    const rn = row.number;
    row.getCell(10).value = f(
      `IF(AND(H${rn}="yes",ISNUMBER(F${rn})),F${rn},"")`,
      p.included && p.evToEbitda !== null ? p.evToEbitda : "",
    );
    row.getCell(11).value = f(
      `IF(AND(H${rn}="yes",ISNUMBER(E${rn})),E${rn},"")`,
      p.included && p.evToRevenue !== null ? p.evToRevenue : "",
    );
    row.getCell(10).numFmt = FMT.mult;
    row.getCell(11).numFmt = FMT.mult;
    for (const c of [3, 4]) row.getCell(c).numFmt = FMT.usd;
    for (const c of [5, 6, 7]) row.getCell(c).numFmt = FMT.mult;
    for (const c of [3, 4, 5, 6, 7]) row.getCell(c).font = { color: BLUE };
    if (!p.included) row.font = { color: GREY, italic: true };
  }
  const lastPeer = comps.rowCount;
  const inc = panel.comps.peers.filter((p) => p.included);
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
  };
  comps.addRow([]).commit();
  const medRow = (text: string, column: string, values: number[], fmt: string) => {
    const r = comps.addRow([text]);
    if (values.length && lastPeer >= firstPeer) {
      r.getCell(2).value = f(`MEDIAN(${column}${firstPeer}:${column}${lastPeer})`, median(values));
      r.getCell(2).numFmt = fmt;
    } else r.getCell(2).value = "n/a";
    r.font = { bold: true };
    return r;
  };
  const evEbitda = inc.flatMap((p) => (p.evToEbitda === null ? [] : [p.evToEbitda]));
  const evRev = inc.flatMap((p) => (p.evToRevenue === null ? [] : [p.evToRevenue]));
  medRow("Median EV/EBITDA (included peers)", "J", evEbitda, FMT.mult);
  medRow("Median EV/Revenue (included peers)", "K", evRev, FMT.mult);
  comps.addRow([]).commit();
  const ip = panel.comps.impliedPerShare;
  if (ip) {
    header(comps.addRow(["Implied value per share", "Low", "Median", "High"]));
    const r = comps.addRow(["Computed by finance package", ip.low, ip.median, ip.high]);
    for (const c of [2, 3, 4]) r.getCell(c).numFmt = FMT.share;
    comps.addRow([ip.basis]).font = { italic: true, color: GREY };
  } else comps.addRow(["Not enough comparable data for an implied value range."]);
  comps.columns = [
    { width: 36 },
    { width: 28 },
    { width: 18 },
    { width: 18 },
    { width: 12 },
    { width: 12 },
    { width: 10 },
    { width: 10 },
    { width: 80 },
    { width: 14 },
    { width: 14 },
  ];
  /* ------------------------------------------------------------------ Sensitivity */
  const s = panel.sensitivity;
  title(sens, s.title, `Rows: ${s.rowLabel}. Columns: ${s.colLabel}. Each cell is a full DCF formula.`);
  sens.getCell("A4").value = "WACC \\ g";
  s.cols.forEach((g, j) => {
    const c = sens.getCell(4, 2 + j);
    c.value = g;
    c.numFmt = FMT.pct;
    c.font = { bold: true, color: BLUE };
    c.fill = HEAD_FILL;
  });
  const ufcfRange = `Model!$${col(first)}$${lines.ufcf}:$${lastCol}$${lines.ufcf}`;
  const lastUfcf = `Model!$${lastCol}$${lines.ufcf}`;
  s.rows.forEach((w, i) => {
    const r = 5 + i;
    const wc = sens.getCell(r, 1);
    wc.value = w;
    wc.numFmt = FMT.pct;
    wc.font = { bold: true, color: BLUE };
    wc.fill = HEAD_FILL;
    s.cols.forEach((_, j) => {
      const g = `${col(2 + j)}$4`;
      const w$ = `$A${r}`;
      const formula = `(NPV(${w$},${ufcfRange})+${lastUfcf}*(1+${g})/(${w$}-${g})/(1+${w$})^${n}-${ref("total_debt")}+${ref("cash")})/${ref("diluted_shares")}`;
      const c = sens.getCell(r, 2 + j);
      c.value = f(formula, (s.values[i] as number[])[j] as number);
      c.numFmt = FMT.share;
    });
  });
  sens.columns = [{ width: 14 }, ...s.cols.map(() => ({ width: 14 }))];

  /* ------------------------------------------------------------------ Sources */
  title(
    sources,
    "Sources and evidence",
    "Every figure traces to one of these. Filing facts carry the accession number.",
  );
  sources.addRow([]).commit();
  header(
    sources.addRow([
      "Evidence id",
      "Kind",
      "Form",
      "Accession",
      "Filed",
      "Section",
      "Quote",
      "URL",
      "Retrieved",
    ]),
  );
  for (const e of Object.values(panel.evidence)) {
    sources.addRow([
      e.id,
      e.kind,
      e.form ?? "",
      e.accession ?? "",
      e.filed ?? "",
      e.section ?? "",
      e.quote ?? "",
      e.url ?? "",
      e.retrievedAt,
    ]);
  }
  sources.columns = [
    { width: 56 },
    { width: 12 },
    { width: 8 },
    { width: 22 },
    { width: 12 },
    { width: 24 },
    { width: 60 },
    { width: 50 },
    { width: 26 },
  ];
  sources.views = [{ state: "frozen", ySplit: 4 }];

  /* ------------------------------------------------------------------ Review (scenarios + findings) */
  title(
    review,
    "Scenarios and review findings",
    "Scenarios are recomputed by the finance package; findings come from the Forensic and Skeptic agents.",
  );
  review.addRow([]).commit();
  header(review.addRow(["Scenario", "Value per share", "Enterprise value", "vs base", "What changed"]));
  for (const sc of panel.scenarios) {
    const r = review.addRow([
      sc.name,
      sc.perShare,
      sc.enterpriseValue,
      sc.deltaVsBase,
      sc.changes.join("; "),
    ]);
    r.getCell(2).numFmt = FMT.share;
    r.getCell(3).numFmt = FMT.usd;
    r.getCell(4).numFmt = FMT.pct;
  }
  review.addRow([]).commit();
  header(review.addRow(["Agent", "Severity", "Finding", "Detail", "Evidence"]));
  for (const fd of panel.findings) {
    review.addRow([fd.agent, fd.severity, fd.title, fd.detail, fd.evidenceIds.join(", ")]);
  }
  review.columns = [{ width: 14 }, { width: 18 }, { width: 50 }, { width: 100 }, { width: 50 }];

  /* ------------------------------------------------------------------ Defects */
  title(
    defects,
    "Independent verification",
    "Result of the Verifier, which recomputes figures and re-resolves citations without sharing state with the producing agents.",
  );
  defects.addRow([]).commit();
  const vr = panel.verification;
  if (!vr) {
    const r = defects.addRow(["NOT VERIFIED: the independent verification has not run for this workbook."]);
    r.font = { bold: true, color: RED };
    r.getCell(1).fill = WARN_FILL;
  } else {
    const sum = vr.summary;
    const banner = defects.addRow([
      sum.unresolved > 0
        ? `${sum.unresolved} UNRESOLVED defect(s): affected figures are unverified.`
        : `All checks complete. ${sum.fixed} defect(s) found and corrected, ${sum.errorsOpen} errors open, ${sum.warningsOpen} warnings.`,
    ]);
    banner.font = { bold: true, color: sum.unresolved > 0 ? RED : undefined };
    if (sum.unresolved > 0) banner.getCell(1).fill = WARN_FILL;
    defects.addRow([]).commit();
    header(defects.addRow(["Check", "Passed", "Items checked", "Note"]));
    for (const c of vr.checks) defects.addRow([c.name, c.passed ? "yes" : "NO", c.items, c.note ?? ""]);
    defects.addRow([]).commit();
    header(defects.addRow(["Type", "Severity", "Owner", "Status", "Retries", "Subject", "Detail"]));
    for (const x of vr.defects) {
      defects.addRow([x.type, x.severity, x.ownerNode, x.status, x.retries, x.subject, x.detail]);
    }
    if (vr.defects.length === 0) defects.addRow(["No defects."]);
  }
  defects.columns = [
    { width: 24 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 10 },
    { width: 34 },
    { width: 110 },
  ];

  /* ------------------------------------------------------------------ Summary */
  title(
    summary,
    `${panel.companyName} (${panel.ticker}): DCF summary`,
    `As of ${panel.asOf.slice(0, 10)}. Generated by DealPilot; every figure is computed by code, not by a language model.`,
  );
  const lines2: [string, ExcelJS.CellValue, string][] = [
    ["DCF value per share", f("DCF!B28", v0.perShare), FMT.share],
    ["Market price", panel.price ?? "n/a", FMT.share],
    [
      "Upside vs market price",
      panel.price === null ? "n/a" : f("DCF!B30", v0.impliedUpsidePct ?? 0),
      FMT.pct,
    ],
    ["Enterprise value", f("DCF!B23", v0.enterpriseValue), FMT.usd],
    ["Equity value", f("DCF!B26", v0.equityValue), FMT.usd],
    ["WACC", f("DCF!B12", wacc), FMT.pct],
    ["Terminal growth", f("DCF!B13", v("terminal_growth")), FMT.pct],
    ["Terminal value share of EV", f("DCF!B31", v0.terminalShareOfEv ?? 0), FMT.pct],
  ];
  lines2.forEach(([text, val, fmt], k) => {
    summary.getCell(`A${4 + k}`).value = text;
    summary.getCell(`B${4 + k}`).value = val;
    summary.getCell(`B${4 + k}`).numFmt = fmt;
  });
  summary.getCell("A4").font = { bold: true };
  summary.getCell("B4").font = { bold: true };
  const status = vr
    ? vr.summary.unresolved > 0
      ? `UNRESOLVED defects: ${vr.summary.unresolved} (see Defects tab)`
      : `Verified: ${vr.checks.filter((c) => c.passed).length} of ${vr.checks.length} checks passed`
    : "NOT VERIFIED";
  summary.getCell("A13").value = "Verification";
  summary.getCell("B13").value = status;
  summary.getCell("A13").font = { bold: true };
  if (!vr || vr.summary.unresolved > 0) summary.getCell("B13").font = { bold: true, color: RED };
  summary.getCell("A15").value = "Tabs";
  summary.getCell("A15").font = { bold: true };
  [
    "Inputs: every input with its source and evidence id",
    "Model: projection (formulas)",
    "DCF: WACC, terminal value, equity bridge (formulas)",
    "Comps: peer multiples and live medians",
    "Sensitivity: WACC x terminal growth grid (each cell a DCF formula)",
    "Sources: evidence and filing citations",
    "Review: scenarios and forensic / skeptic findings",
    "Defects: independent verification result",
  ].forEach((t, k) => {
    summary.getCell(`A${16 + k}`).value = t;
  });
  summary.columns = [{ width: 36 }, { width: 40 }];

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}
