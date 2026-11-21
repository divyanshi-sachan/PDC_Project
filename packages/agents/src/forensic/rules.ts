import {
  accrualsRatio,
  arithmeticMean,
  daysSalesOutstanding,
  ebitMargin,
  effectiveTaxRate,
  FinanceInputError,
  growthGap,
  growthRate,
  percentOf,
  zScoreOfLast,
} from "@dealpilot/finance";
import type { Fact, Finding } from "@dealpilot/shared";
import type { CompanyHistory, HistoryItem } from "../research/types.ts";

/* ---------------------------------------------------------------- thresholds (documented, named) */

/** Accruals ratio (NI − CFO) / average total assets: above → medium / high. */
export const ACCRUALS_MEDIUM = 0.1;
export const ACCRUALS_HIGH = 0.2;
/** Operating cash flow below this share of net income counts as weak cash conversion. */
export const CASH_CONVERSION_MIN = 0.7;
/** Number of weak years (out of the last 3) that raises the cash-conversion flag. */
export const CASH_CONVERSION_WEAK_YEARS = 2;
/** Receivables growth minus revenue growth, as a decimal (0.10 = 10 points): above → medium / high. */
export const RECEIVABLES_GAP_MEDIUM = 0.1;
export const RECEIVABLES_GAP_HIGH = 0.2;
/** Year-on-year rise in DSO that raises a medium flag. */
export const DSO_RISE = 0.15;
/** Inventory growth minus revenue growth that raises a medium flag. */
export const INVENTORY_GAP_MEDIUM = 0.15;
/** |z-score| of the latest EBIT margin vs prior years that raises a medium flag. */
export const MARGIN_Z_LIMIT = 2;
/** |pretax income / EBIT − 1| above this means large non-operating items (medium). */
export const NON_OPERATING_GAP = 0.25;
/** Latest effective tax rate vs the average of up to 3 prior years, in points as a decimal (low). */
export const TAX_RATE_SWING = 0.08;
/** Capex below this share of D&A for 3 consecutive years suggests under-investment (low). */
export const CAPEX_TO_DA_MIN = 0.6;
/** Total debt growth above this while revenue growth is below {@link LEVERAGE_REVENUE_GROWTH_MAX} (medium). */
export const DEBT_GROWTH_LIMIT = 0.3;
export const LEVERAGE_REVENUE_GROWTH_MAX = 0.05;
/** Basic share count growth per year above this raises a low flag. */
export const DILUTION_LIMIT = 0.04;
/** How many most recent fiscal years are checked for restated facts. */
export const RESTATEMENT_YEARS = 3;

export interface RuleMeta {
  id: string;
  name: string;
  thresholds: string;
  severity: string;
}

/** Rule catalogue (documentation and tests). */
export const RULES: readonly RuleMeta[] = [
  {
    id: "accruals",
    name: "Earnings quality / accruals ratio",
    thresholds: `(NI − CFO) / avg total assets > ${ACCRUALS_MEDIUM} (medium), > ${ACCRUALS_HIGH} (high)`,
    severity: "medium | high",
  },
  {
    id: "cash_negative_ocf",
    name: "Negative operating cash flow despite profit",
    thresholds: "OCF < 0 with NI > 0 in the latest year",
    severity: "high",
  },
  {
    id: "cash_conversion",
    name: "Weak cash conversion",
    thresholds: `OCF < ${CASH_CONVERSION_MIN} × NI in ≥ ${CASH_CONVERSION_WEAK_YEARS} of the last 3 years (NI > 0)`,
    severity: "medium",
  },
  {
    id: "receivables",
    name: "Receivables outpacing revenue",
    thresholds: `receivables growth − revenue growth > ${RECEIVABLES_GAP_MEDIUM} (medium), > ${RECEIVABLES_GAP_HIGH} (high)`,
    severity: "medium | high",
  },
  {
    id: "dso",
    name: "DSO rising",
    thresholds: `DSO up > ${DSO_RISE} year on year`,
    severity: "medium",
  },
  {
    id: "inventory",
    name: "Inventory build",
    thresholds: `inventory growth − revenue growth > ${INVENTORY_GAP_MEDIUM}`,
    severity: "medium",
  },
  {
    id: "margin_z",
    name: "Margin volatility",
    thresholds: `|z| of latest EBIT margin vs prior years (≥ 3 prior) > ${MARGIN_Z_LIMIT}`,
    severity: "medium",
  },
  {
    id: "non_operating",
    name: "Large non-operating items",
    thresholds: `|pretax income / EBIT − 1| > ${NON_OPERATING_GAP} (EBIT > 0)`,
    severity: "medium",
  },
  {
    id: "tax_rate",
    name: "Tax rate swing",
    thresholds: `|latest ETR − mean of 2-3 prior ETRs| > ${TAX_RATE_SWING}`,
    severity: "low",
  },
  {
    id: "capex_da",
    name: "Capex persistently below D&A",
    thresholds: `capex / D&A < ${CAPEX_TO_DA_MIN} in each of the last 3 years`,
    severity: "low",
  },
  {
    id: "leverage",
    name: "Leverage rising without growth",
    thresholds: `total debt growth > ${DEBT_GROWTH_LIMIT} and revenue growth < ${LEVERAGE_REVENUE_GROWTH_MAX}`,
    severity: "medium",
  },
  {
    id: "dilution",
    name: "Share dilution",
    thresholds: `basic shares growth > ${DILUTION_LIMIT} in the latest year`,
    severity: "low",
  },
  {
    id: "restated",
    name: "Restated figures",
    thresholds: `any fact flagged restated in the last ${RESTATEMENT_YEARS} fiscal years`,
    severity: "medium",
  },
];

/* ---------------------------------------------------------------- helpers */

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const pts = (x: number): string => `${(x * 100).toFixed(1)} points`;
const days = (ms: number): number => ms / 86_400_000;

interface Ctx {
  /** Fiscal year ends, newest first, from the revenue series. */
  ends: string[];
  /** Fact for an item at (or within 10 days of) a fiscal year end. */
  at(item: HistoryItem, end: string): Fact | undefined;
}

function makeCtx(h: CompanyHistory): Ctx {
  const ends = (h.items.revenue ?? []).map((f) => f.period.end);
  return {
    ends,
    at(item, end) {
      const facts = h.items[item] ?? [];
      const exact = facts.find((f) => f.period.end === end);
      if (exact) return exact;
      const t = Date.parse(`${end}T00:00:00Z`);
      return facts.find((f) => Math.abs(days(Date.parse(`${f.period.end}T00:00:00Z`) - t)) <= 10);
    },
  };
}

const ids = (...facts: (Fact | undefined)[]): string[] => [
  ...new Set(facts.flatMap((f) => (f ? [f.evidence.id] : []))),
];

function finding(
  rule: string,
  end: string,
  severity: Finding["severity"],
  title: string,
  detail: string,
  evidence: string[],
): Finding {
  return {
    id: `forensic:${rule}:${end}`,
    agent: "forensic",
    severity,
    title,
    detail,
    evidenceIds: evidence,
    basis: rule,
  };
}

type Rule = (h: CompanyHistory, c: Ctx) => Finding[];

/** Latest and prior fiscal year ends. */
function twoYears(c: Ctx): [string, string] | null {
  const [e0, e1] = c.ends;
  return e0 && e1 ? [e0, e1] : null;
}

/* ---------------------------------------------------------------- rules */

const accruals: Rule = (_h, c) => {
  const y = twoYears(c);
  if (!y) return [];
  const [e0, e1] = y;
  const ni = c.at("netIncome", e0);
  const cfo = c.at("operatingCashFlow", e0);
  const ta0 = c.at("totalAssets", e0);
  const ta1 = c.at("totalAssets", e1);
  if (!ni || !cfo || !ta0 || !ta1) return [];
  const avg = arithmeticMean({ values: [ta0.value, ta1.value] }).value;
  const r = accrualsRatio({
    netIncome: ni.value,
    operatingCashFlow: cfo.value,
    averageTotalAssets: avg,
  }).value;
  if (r <= ACCRUALS_MEDIUM) return [];
  return [
    finding(
      "accruals",
      e0,
      r > ACCRUALS_HIGH ? "high" : "medium",
      "High accruals: earnings not backed by cash",
      `Net income exceeded operating cash flow by ${pct(r)} of average total assets in the fiscal year ended ${e0}, above the ${pct(ACCRUALS_MEDIUM)} warning level.`,
      ids(ni, cfo, ta0, ta1),
    ),
  ];
};

const cashNegative: Rule = (_h, c) => {
  const e0 = c.ends[0];
  if (!e0) return [];
  const ni = c.at("netIncome", e0);
  const cfo = c.at("operatingCashFlow", e0);
  if (!ni || !cfo || !(ni.value > 0) || !(cfo.value < 0)) return [];
  return [
    finding(
      "cash_negative_ocf",
      e0,
      "high",
      "Profitable on paper but burning operating cash",
      `Operating cash flow was negative while net income was positive in the fiscal year ended ${e0}.`,
      ids(ni, cfo),
    ),
  ];
};

const cashConversion: Rule = (_h, c) => {
  const last3 = c.ends.slice(0, 3);
  if (last3.length < 3) return [];
  const e0 = last3[0] as string;
  const ni0 = c.at("netIncome", e0);
  const cfo0 = c.at("operatingCashFlow", e0);
  if (ni0 && cfo0 && ni0.value > 0 && cfo0.value < 0) return []; // reported as the high-severity rule
  const used: Fact[] = [];
  let weak = 0;
  for (const end of last3) {
    const ni = c.at("netIncome", end);
    const cfo = c.at("operatingCashFlow", end);
    if (!ni || !cfo) return [];
    used.push(ni, cfo);
    if (ni.value > 0 && percentOf({ part: cfo.value, whole: ni.value }).value < CASH_CONVERSION_MIN) weak++;
  }
  if (weak < CASH_CONVERSION_WEAK_YEARS) return [];
  return [
    finding(
      "cash_conversion",
      e0,
      "medium",
      "Weak cash conversion",
      `Operating cash flow was below ${pct(CASH_CONVERSION_MIN)} of net income in ${weak} of the last 3 fiscal years (latest year ended ${e0}).`,
      ids(...used),
    ),
  ];
};

/** growthRate of an item between the two latest year ends, with its facts. */
function yoy(c: Ctx, item: HistoryItem) {
  const y = twoYears(c);
  if (!y) return null;
  const cur = c.at(item, y[0]);
  const prev = c.at(item, y[1]);
  if (!cur || !prev) return null;
  return { cur, prev, g: growthRate({ previous: prev.value, current: cur.value }).value };
}

const receivables: Rule = (_h, c) => {
  const e0 = c.ends[0];
  const rec = yoy(c, "receivables");
  const rev = yoy(c, "revenue");
  if (!e0 || !rec || !rev) return [];
  const gap = growthGap({ growthA: rec.g, growthB: rev.g }).value;
  if (gap <= RECEIVABLES_GAP_MEDIUM) return [];
  return [
    finding(
      "receivables",
      e0,
      gap > RECEIVABLES_GAP_HIGH ? "high" : "medium",
      "Receivables growing faster than revenue",
      `Receivables grew ${pct(rec.g)} against revenue growth of ${pct(rev.g)} (gap ${pts(gap)}) in the fiscal year ended ${e0}.`,
      ids(rec.cur, rec.prev, rev.cur, rev.prev),
    ),
  ];
};

const dso: Rule = (_h, c) => {
  const e0 = c.ends[0];
  const rec = yoy(c, "receivables");
  const rev = yoy(c, "revenue");
  if (!e0 || !rec || !rev) return [];
  const d0 = daysSalesOutstanding({ receivables: rec.cur.value, revenue: rev.cur.value }).value;
  const d1 = daysSalesOutstanding({ receivables: rec.prev.value, revenue: rev.prev.value }).value;
  const rise = growthRate({ previous: d1, current: d0 }).value;
  if (rise <= DSO_RISE) return [];
  return [
    finding(
      "dso",
      e0,
      "medium",
      "Days sales outstanding rising",
      `DSO rose from ${d1.toFixed(1)} to ${d0.toFixed(1)} days (${pct(rise)}) in the fiscal year ended ${e0}.`,
      ids(rec.cur, rec.prev, rev.cur, rev.prev),
    ),
  ];
};

const inventory: Rule = (_h, c) => {
  const e0 = c.ends[0];
  const inv = yoy(c, "inventory");
  const rev = yoy(c, "revenue");
  if (!e0 || !inv || !rev) return [];
  const gap = growthGap({ growthA: inv.g, growthB: rev.g }).value;
  if (gap <= INVENTORY_GAP_MEDIUM) return [];
  return [
    finding(
      "inventory",
      e0,
      "medium",
      "Inventory building faster than revenue",
      `Inventory grew ${pct(inv.g)} against revenue growth of ${pct(rev.g)} (gap ${pts(gap)}) in the fiscal year ended ${e0}.`,
      ids(inv.cur, inv.prev, rev.cur, rev.prev),
    ),
  ];
};

const marginZ: Rule = (_h, c) => {
  if (c.ends.length < 4) return [];
  const used: Fact[] = [];
  const margins: number[] = []; // newest first
  for (const end of c.ends) {
    const e = c.at("ebit", end);
    const r = c.at("revenue", end);
    if (!e || !r) return [];
    used.push(e, r);
    margins.push(ebitMargin({ ebit: e.value, revenue: r.value }).value);
  }
  const z = zScoreOfLast({ values: [...margins].reverse() }).value;
  if (Math.abs(z) <= MARGIN_Z_LIMIT) return [];
  const e0 = c.ends[0] as string;
  return [
    finding(
      "margin_z",
      e0,
      "medium",
      "EBIT margin out of line with history",
      `The EBIT margin of ${pct(margins[0] as number)} in the fiscal year ended ${e0} sits ${Math.abs(z).toFixed(1)} standard deviations ${z > 0 ? "above" : "below"} the prior ${margins.length - 1} years.`,
      ids(...used),
    ),
  ];
};

const nonOperating: Rule = (_h, c) => {
  const e0 = c.ends[0];
  if (!e0) return [];
  const ebit = c.at("ebit", e0);
  const pre = c.at("pretaxIncome", e0);
  if (!ebit || !pre || !(ebit.value > 0)) return [];
  const g = growthRate({ previous: ebit.value, current: pre.value }).value; // pretax / EBIT − 1
  if (Math.abs(g) <= NON_OPERATING_GAP) return [];
  return [
    finding(
      "non_operating",
      e0,
      "medium",
      "Large non-operating items between EBIT and pretax income",
      `Pretax income was ${pct(Math.abs(g))} ${g > 0 ? "above" : "below"} operating income (EBIT) in the fiscal year ended ${e0}, so non-operating items drive a large part of the result.`,
      ids(ebit, pre),
    ),
  ];
};

const taxRate: Rule = (_h, c) => {
  if (c.ends.length < 3) return [];
  const [e0, ...older] = c.ends.slice(0, 4);
  if (!e0) return [];
  const rate = (end: string) => {
    const t = c.at("incomeTaxExpense", end);
    const p = c.at("pretaxIncome", end);
    if (!t || !p || !(p.value > 0)) return null;
    return { t, p, r: effectiveTaxRate({ incomeTax: t.value, pretaxIncome: p.value }).value };
  };
  const cur = rate(e0);
  if (!cur) return [];
  const prior = older.map(rate).filter((x): x is NonNullable<typeof x> => x !== null);
  if (prior.length < 2) return [];
  const avg = arithmeticMean({ values: prior.map((x) => x.r) }).value;
  const gap = growthGap({ growthA: cur.r, growthB: avg }).value;
  if (Math.abs(gap) <= TAX_RATE_SWING) return [];
  return [
    finding(
      "tax_rate",
      e0,
      "low",
      "Effective tax rate swing",
      `The effective tax rate was ${pct(cur.r)} in the fiscal year ended ${e0} against an average of ${pct(avg)} over the previous ${prior.length} years (gap ${pts(Math.abs(gap))}).`,
      ids(cur.t, cur.p, ...prior.flatMap((x) => [x.t, x.p])),
    ),
  ];
};

const capexDa: Rule = (_h, c) => {
  const last3 = c.ends.slice(0, 3);
  if (last3.length < 3) return [];
  const used: Fact[] = [];
  const ratios: number[] = [];
  for (const end of last3) {
    const cx = c.at("capex", end);
    const da = c.at("depreciationAndAmortization", end);
    if (!cx || !da || !(da.value > 0)) return [];
    used.push(cx, da);
    ratios.push(percentOf({ part: cx.value, whole: da.value }).value);
  }
  if (!ratios.every((r) => r < CAPEX_TO_DA_MIN)) return [];
  const e0 = last3[0] as string;
  return [
    finding(
      "capex_da",
      e0,
      "low",
      "Capex persistently below depreciation",
      `Capital expenditure was ${pct(ratios[0] as number)} of depreciation and amortization in the fiscal year ended ${e0} and below ${pct(CAPEX_TO_DA_MIN)} in each of the last 3 years, which can signal under-investment.`,
      ids(...used),
    ),
  ];
};

const leverage: Rule = (_h, c) => {
  const e0 = c.ends[0];
  const debt = yoy(c, "totalDebt");
  const rev = yoy(c, "revenue");
  if (!e0 || !debt || !rev) return [];
  if (!(debt.g > DEBT_GROWTH_LIMIT) || !(rev.g < LEVERAGE_REVENUE_GROWTH_MAX)) return [];
  return [
    finding(
      "leverage",
      e0,
      "medium",
      "Debt rising while growth is weak",
      `Total debt grew ${pct(debt.g)} while revenue grew only ${pct(rev.g)} in the fiscal year ended ${e0}.`,
      ids(debt.cur, debt.prev, rev.cur, rev.prev),
    ),
  ];
};

const dilution: Rule = (_h, c) => {
  const e0 = c.ends[0];
  const sh = yoy(c, "basicShares");
  if (!e0 || !sh || !(sh.g > DILUTION_LIMIT)) return [];
  return [
    finding(
      "dilution",
      e0,
      "low",
      "Share count growing",
      `The weighted-average basic share count grew ${pct(sh.g)} in the fiscal year ended ${e0}.`,
      ids(sh.cur, sh.prev),
    ),
  ];
};

const restated: Rule = (h, c) => {
  const recent = new Set(c.ends.slice(0, RESTATEMENT_YEARS));
  const byEnd = new Map<string, Fact[]>();
  for (const facts of Object.values(h.items)) {
    for (const f of facts ?? []) {
      if (!f.restated) continue;
      if (!recent.has(f.period.end)) continue;
      byEnd.set(f.period.end, [...(byEnd.get(f.period.end) ?? []), f]);
    }
  }
  return [...byEnd.entries()].map(([end, facts]) =>
    finding(
      "restated",
      end,
      "medium",
      "Reported figures were restated",
      `${facts.length} reported figure${facts.length === 1 ? "" : "s"} for the fiscal year ended ${end} (${[...new Set(facts.map((f) => f.label))].join(", ")}) ${facts.length === 1 ? "was" : "were"} later restated.`,
      ids(...facts),
    ),
  );
};

const ALL: Rule[] = [
  accruals,
  cashNegative,
  cashConversion,
  receivables,
  dso,
  inventory,
  marginZ,
  nonOperating,
  taxRate,
  capexDa,
  leverage,
  dilution,
  restated,
];

/**
 * Deterministic accounting red-flag rules over a company's cited history. Pure: the same history always
 * yields the same findings with stable ids (`forensic:<rule>:<fiscal year end>`). A rule whose inputs are
 * missing or unusable (non-positive denominators) is skipped silently; nothing is guessed.
 */
export function forensicRules(history: CompanyHistory): Finding[] {
  const c = makeCtx(history);
  const out: Finding[] = [];
  for (const rule of ALL) {
    try {
      out.push(...rule(history, c));
    } catch (e) {
      if (!(e instanceof FinanceInputError)) throw e;
    }
  }
  return out;
}
