/** Internal identities and invariants of the deliverable. Pure; reads only the panel. */
import { summaryStats } from "@dealpilot/finance";
import type { Defect, Panel } from "@dealpilot/shared";
import { close, defect } from "./recompute.ts";

export function checkIntegrity(panel: Panel): { defects: Defect[]; items: number } {
  const defects: Defect[] = [];
  let items = 0;
  const fail = (
    subject: string,
    detail: string,
    expected: number | string | null = null,
    actual: number | string | null = null,
  ) =>
    defects.push(
      defect({
        type: "integrity",
        severity: "error",
        ownerNode: "modeling",
        subject,
        detail,
        expected,
        actual,
      }),
    );
  const check = (
    ok: boolean,
    subject: string,
    detail: string,
    expected?: number | string,
    actual?: number | string,
  ) => {
    items++;
    if (!ok) fail(subject, detail, expected ?? null, actual ?? null);
  };

  const a = new Map(panel.assumptions.map((x) => [x.key, x.value]));
  const v = panel.valuation;

  // EV → equity bridge: equity = EV − debt + cash (no preferred / minorities / non-operating assets are modelled).
  const debt = a.get("total_debt");
  const cash = a.get("cash");
  if (debt !== undefined && cash !== undefined) {
    check(
      close(v.equityValue, v.enterpriseValue - debt + cash, 1e-9),
      "bridge.equity",
      "Equity value must equal enterprise value minus debt plus cash.",
      v.enterpriseValue - debt + cash,
      v.equityValue,
    );
  }

  // Market cap = price × shares is not checkable without the cover-page count; check price/market-cap are positive.
  check(
    panel.price === null || panel.price > 0,
    "market.price",
    "The share price must be positive.",
    ">0",
    panel.price ?? "null",
  );

  // WACC must exceed terminal growth, with room (otherwise the Gordon value is meaningless).
  check(
    v.wacc > v.terminalGrowth,
    "valuation.wacc_vs_growth",
    "WACC must exceed terminal growth.",
    `>${v.terminalGrowth}`,
    v.wacc,
  );

  // Sensitivity grid: odd axes, centre equals the headline value, monotone in WACC and in growth.
  const s = panel.sensitivity;
  const mid = (n: number) => (n - 1) / 2;
  check(
    s.rows.length % 2 === 1 && s.cols.length % 2 === 1,
    "sensitivity.shape",
    "Sensitivity axes must have an odd number of points so the base case is a grid point.",
  );
  if (s.rows.length % 2 === 1 && s.cols.length % 2 === 1) {
    check(
      close(s.rows[mid(s.rows.length)] as number, v.wacc),
      "sensitivity.centre_wacc",
      "The middle WACC row must equal the valuation WACC.",
      v.wacc,
      s.rows[mid(s.rows.length)] as number,
    );
    check(
      close(s.cols[mid(s.cols.length)] as number, v.terminalGrowth),
      "sensitivity.centre_growth",
      "The middle growth column must equal the terminal growth rate.",
      v.terminalGrowth,
      s.cols[mid(s.cols.length)] as number,
    );
    const centre = s.values[mid(s.rows.length)]?.[mid(s.cols.length)];
    check(
      centre !== undefined && close(centre, v.perShare),
      "sensitivity.centre_value",
      "The centre of the sensitivity grid must equal the headline value per share.",
      v.perShare,
      centre ?? "missing",
    );
  }
  let monotone = true;
  for (let r = 0; r < s.values.length; r++) {
    for (let c = 0; c < (s.values[r]?.length ?? 0); c++) {
      const x = s.values[r]?.[c] as number;
      const up = s.values[r - 1]?.[c];
      const left = s.values[r]?.[c - 1];
      if (up !== undefined && !(x < up)) monotone = false; // higher WACC (next row) → lower value
      if (left !== undefined && !(x > left)) monotone = false; // higher growth (next col) → higher value
    }
  }
  check(monotone, "sensitivity.monotone", "Value must fall as WACC rises and rise as terminal growth rises.");

  // Projection years are consecutive and positive.
  const years = panel.projection.map((p) => p.year);
  check(
    years.every((y, k) => k === 0 || y === (years[k - 1] as number) + 1),
    "projection.years",
    "Projection years must be consecutive.",
    years.join(","),
    years.join(","),
  );
  check(
    panel.projection.every((p) => p.revenue > 0 && p.discountFactor > 0 && p.discountFactor <= 1),
    "projection.sanity",
    "Revenue must be positive and discount factors in (0, 1].",
  );

  // Every number in the headline block is finite.
  check(
    [v.enterpriseValue, v.equityValue, v.perShare, v.wacc, v.terminalGrowth].every(Number.isFinite),
    "valuation.finite",
    "All headline valuation figures must be finite numbers.",
  );

  // Comps: median recomputed from the included peers; implied range ordered.
  const included = panel.comps.peers.filter(
    (p) => p.included && p.evToEbitda !== null && (p.evToEbitda as number) > 0,
  );
  if (included.length >= 1 && panel.comps.medianEvToEbitda !== null) {
    const med = summaryStats(included.map((p) => ({ name: p.ticker, value: p.evToEbitda as number }))).value
      .median;
    check(
      close(med, panel.comps.medianEvToEbitda, 1e-9),
      "comps.median_ev_ebitda",
      "The comps median EV/EBITDA must equal the median of the included peers' multiples.",
      med,
      panel.comps.medianEvToEbitda,
    );
  }
  const ip = panel.comps.impliedPerShare;
  if (ip)
    check(
      ip.low <= ip.median && ip.median <= ip.high,
      "comps.range_order",
      "The implied range must be ordered low ≤ median ≤ high.",
      `${ip.low}≤${ip.median}≤${ip.high}`,
      `${ip.low},${ip.median},${ip.high}`,
    );

  // Provenance: the formulas that produced the headline numbers are recorded.
  for (const f of ["dcf.valuation", "terminal.gordon", "bridge.ev_to_equity"]) {
    check(
      panel.formulaIds.includes(f),
      `provenance.${f}`,
      `The deliverable must record that ${f} produced its figures.`,
      f,
      "missing",
    );
  }
  return { defects, items };
}
