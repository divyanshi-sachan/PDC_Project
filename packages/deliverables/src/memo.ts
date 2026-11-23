/**
 * Deal memo (.docx). All prose is assembled by code from the panel: every figure is a formatted value that the
 * finance package computed, and each cited input carries a footnote with its filing or market-data source.
 * The only model-written text is the optional digit-free commentary passed in by the caller.
 */
import type { Evidence, Panel } from "@dealpilot/shared";
import {
  AlignmentType,
  Document,
  FootnoteReferenceRun,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const usd = (x: number): string => {
  const a = Math.abs(x);
  const sign = x < 0 ? "-" : "";
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)} trillion`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)} billion`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)} million`;
  return `${sign}$${a.toFixed(2)}`;
};
const share = (x: number) => `$${x.toFixed(2)}`;
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

export function describeEvidence(e: Evidence): string {
  if (e.kind === "xbrl_fact")
    return `${e.form ?? "Filing"} accession ${e.accession ?? "n/a"}, filed ${e.filed ?? "n/a"}. SEC XBRL fact ${e.id}.`;
  if (e.kind === "filing_text")
    return `${e.form ?? "Filing"} ${e.accession ?? ""} ${e.section ?? ""}${e.quote ? `: “${e.quote.slice(0, 200)}”` : ""}`;
  return `${e.section ?? e.kind}${e.url ? `, ${e.url}` : ""}, retrieved ${e.retrievedAt.slice(0, 10)}.`;
}

export interface MemoOptions {
  /** Qualitative commentary (digit-free), written by the respond agent. */
  commentary?: string | null;
}

const cell = (text: string, bold = false, right = false) =>
  new TableCell({
    children: [
      new Paragraph({
        alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [new TextRun({ text, bold })],
      }),
    ],
  });

const table = (head: string[], rows: string[][]) =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: head.map((h, k) => cell(h, true, k > 0)) }),
      ...rows.map((r) => new TableRow({ children: r.map((t, k) => cell(t, false, k > 0)) })),
    ],
  });

export async function buildMemo(panel: Panel, opts: MemoOptions = {}): Promise<Uint8Array> {
  // One footnote per distinct evidence id, numbered in order of first use.
  const footnotes: Record<number, { children: Paragraph[] }> = {};
  const noteOf = new Map<string, number>();
  const cite = (evidenceId: string | null): FootnoteReferenceRun[] => {
    const e = evidenceId ? panel.evidence[evidenceId] : undefined;
    if (!e || !evidenceId) return [];
    let n = noteOf.get(evidenceId);
    if (n === undefined) {
      n = noteOf.size + 1;
      noteOf.set(evidenceId, n);
      footnotes[n] = { children: [new Paragraph({ children: [new TextRun(describeEvidence(e))] })] };
    }
    return [new FootnoteReferenceRun(n)];
  };
  const para = (text: string, evidenceIds: (string | null)[] = []) =>
    new Paragraph({ children: [new TextRun(text), ...evidenceIds.flatMap(cite)], spacing: { after: 120 } });
  const h = (text: string) =>
    new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 240 } });
  const a = (key: string) => panel.assumptions.find((x) => x.key === key);

  const v = panel.valuation;
  const children: (Paragraph | Table)[] = [];
  children.push(
    new Paragraph({ text: `${panel.companyName} (${panel.ticker})`, heading: HeadingLevel.TITLE }),
  );
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Valuation memo, as of ${panel.asOf.slice(0, 10)}`, italics: true })],
    }),
  );

  // Verification status goes first: a reader must know how much to trust the numbers.
  const vr = panel.verification;
  const status = !vr
    ? "NOT VERIFIED: the independent verification did not run for this memo."
    : vr.summary.unresolved > 0
      ? `UNRESOLVED defects: ${vr.summary.unresolved}. The affected figures are unverified; see the Defects section.`
      : `Independently verified: ${vr.checks.filter((c) => c.passed).length} of ${vr.checks.length} checks passed${vr.summary.fixed ? `; ${vr.summary.fixed} defect(s) were found and corrected` : ""}.`;
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: status,
          bold: true,
          color: !vr || vr.summary.unresolved > 0 ? "B00020" : "1B5E20",
        }),
      ],
      spacing: { before: 120, after: 120 },
    }),
  );

  children.push(h("Summary"));
  const vs =
    panel.price !== null && v.impliedUpsidePct !== null
      ? `, against a market price of ${share(panel.price)} (${pct(Math.abs(v.impliedUpsidePct))} ${v.impliedUpsidePct >= 0 ? "above" : "below"} market)`
      : "";
  children.push(
    para(
      `The discounted cash flow values ${panel.companyName} at ${share(v.perShare)} per share${vs}. Enterprise value is ${usd(v.enterpriseValue)} and equity value is ${usd(v.equityValue)}, using a WACC of ${pct(v.wacc, 2)} and terminal growth of ${pct(v.terminalGrowth)}.${v.terminalShareOfEv !== null ? ` The terminal value is ${pct(v.terminalShareOfEv, 0)} of enterprise value.` : ""}`,
      [a("price")?.evidenceId ?? null, a("revenue_base")?.evidenceId ?? null],
    ),
  );
  if (opts.commentary) children.push(para(opts.commentary));

  const ip = panel.comps.impliedPerShare;
  const included = panel.comps.peers.filter((p) => p.included);
  children.push(
    para(
      ip
        ? `Trading comparables (${included.length} peers) imply ${share(ip.low)} to ${share(ip.high)} per share, with a median of ${share(ip.median)}.`
        : "There is not enough comparable data for a trading-comps range.",
    ),
  );

  children.push(h("Valuation"));
  children.push(
    table(
      ["Measure", "Value"],
      [
        ["DCF value per share", share(v.perShare)],
        ["Enterprise value", usd(v.enterpriseValue)],
        ["Equity value", usd(v.equityValue)],
        ["WACC", pct(v.wacc, 2)],
        ["Terminal growth", pct(v.terminalGrowth)],
        ...(panel.scenarios.length
          ? panel.scenarios.map((s) => [
              `Scenario: ${s.name}`,
              `${share(s.perShare)} (${pct(s.deltaVsBase)} vs base)`,
            ])
          : []),
      ],
    ),
  );

  children.push(h("Key inputs"));
  const keys = [
    "revenue_base",
    "tax_rate",
    "diluted_shares",
    "total_debt",
    "cash",
    "risk_free",
    "beta",
    "erp",
    "market_cap",
    "price",
  ];
  const rows: Paragraph[] = [];
  for (const k of keys) {
    const x = a(k);
    if (!x) continue;
    const val =
      x.unit === "pct"
        ? pct(x.value, 2)
        : x.unit === "usd"
          ? x.value >= 1e5
            ? usd(x.value)
            : share(x.value)
          : x.unit === "shares"
            ? x.value.toLocaleString("en-US")
            : x.value.toFixed(2);
    rows.push(para(`${x.label}: ${val}`, [x.evidenceId]));
  }
  children.push(...rows);

  if (panel.comps.peers.length) {
    children.push(h("Comparable companies"));
    children.push(
      table(
        ["Peer", "EV/EBITDA", "EV/Revenue", "Included"],
        panel.comps.peers.map((p) => [
          `${p.ticker} ${p.name}`,
          p.evToEbitda === null ? "n/a" : `${p.evToEbitda.toFixed(1)}x`,
          p.evToRevenue === null ? "n/a" : `${p.evToRevenue.toFixed(1)}x`,
          p.included ? "yes" : `no: ${p.excludedReason ?? ""}`,
        ]),
      ),
    );
  }

  children.push(h("Risks and review findings"));
  if (panel.findings.length === 0 && panel.risks.length === 0)
    children.push(para("No findings were raised."));
  for (const f of panel.findings) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `[${f.agent}, ${f.severity}] ${f.title}. `, bold: true }),
          new TextRun(f.detail),
          ...f.evidenceIds.flatMap(cite),
        ],
        spacing: { after: 100 },
      }),
    );
  }
  for (const r of panel.risks) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${r.title}. `, bold: true }),
          new TextRun(r.detail),
          ...r.evidenceIds.flatMap(cite),
        ],
        spacing: { after: 100 },
      }),
    );
  }

  children.push(h("Defects"));
  if (!vr) children.push(para("Verification did not run, so no defect report is available."));
  else if (vr.defects.length === 0) children.push(para("The Verifier found no defects."));
  else
    children.push(
      table(
        ["Type", "Severity", "Status", "Detail"],
        vr.defects.map((d) => [d.type, d.severity, d.status, d.detail]),
      ),
    );

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "Method: every figure was computed by deterministic code from SEC filings and market data; language models selected assumptions and peers and wrote commentary but did not compute numbers. This memo is for education and portfolio demonstration, not investment advice.",
          italics: true,
          size: 18,
        }),
      ],
      spacing: { before: 240 },
    }),
  );

  const doc = new Document({
    creator: "DealPilot",
    title: `${panel.companyName} valuation memo`,
    footnotes,
    sections: [{ children }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
