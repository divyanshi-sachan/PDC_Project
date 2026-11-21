import { type Db, filings, inArray } from "@dealpilot/db";
import type { LlmClient } from "@dealpilot/llm";
import type { Evidence, Finding } from "@dealpilot/shared";
import { type Embedder, hybridSearch, type SearchHit } from "@dealpilot/sources";
import { z } from "zod";
import { loadPrompt } from "../prompts.ts";

export interface ForensicTopic {
  id: string;
  label: string;
  query: string;
  severity: Finding["severity"];
}

/** Red-flag topics searched in the filing text. */
export const TEXT_TOPICS: readonly ForensicTopic[] = [
  {
    id: "material_weakness",
    label: "Material weakness in internal control over financial reporting",
    query: "material weakness in internal control over financial reporting",
    severity: "high",
  },
  {
    id: "restatement",
    label: "Restatement or correction of an error in previously issued financial statements",
    query: "restatement of previously issued financial statements correction of an error",
    severity: "high",
  },
  {
    id: "going_concern",
    label: "Substantial doubt about the ability to continue as a going concern",
    query: "substantial doubt about ability to continue as a going concern",
    severity: "high",
  },
  {
    id: "auditor_change",
    label: "Change in, or disagreement with, the independent auditor",
    query: "change in independent registered public accounting firm disagreements with auditor",
    severity: "medium",
  },
  {
    id: "concentration",
    label: "Significant customer or supplier concentration",
    query: "significant customer concentration single supplier sole source percent of revenue",
    severity: "low",
  },
  {
    id: "related_party",
    label: "Related-party transactions",
    query: "related party transactions with officers directors or affiliates",
    severity: "low",
  },
  {
    id: "litigation",
    label: "Pending material litigation or regulatory investigation",
    query: "pending material litigation legal proceedings regulatory investigation",
    severity: "medium",
  },
  {
    id: "goodwill_impairment",
    label: "Goodwill or intangible asset impairment",
    query: "goodwill impairment charge intangible assets impaired",
    severity: "medium",
  },
];

const TOPIC_IDS = TEXT_TOPICS.map((t) => t.id) as [string, ...string[]];

const schema = z.object({
  disclosures: z
    .array(
      z.object({
        topic: z.enum(TOPIC_IDS),
        chunkId: z.string(),
        // Verbatim-ness is checked in code (the finding is dropped on failure), not by the schema.
        quote: z.string().min(8).max(500),
        detail: z
          .string()
          .min(1)
          .max(400)
          .refine((s) => !/\d/.test(s), "detail must not contain digits; remove every number"),
      }),
    )
    .max(TEXT_TOPICS.length * 2),
});

export interface ForensicTextResult {
  findings: Finding[];
  evidence: Evidence[];
}

/**
 * Evidence-grounded reading of the filing text. Retrieves passages per red-flag topic, asks the model which
 * topics the passages DISCLOSE, and keeps a finding only when its quote is a verbatim substring of the cited
 * retrieved chunk. The model's `detail` cannot contain digits, so it cannot introduce numbers.
 * Returns no findings, without calling the model, when the company has no indexed chunks.
 */
export async function reviewFilingText(
  deps: { llm: LlmClient; db: Db; embedder: Embedder },
  ctx: { cik: string; companyName: string },
): Promise<ForensicTextResult> {
  const searched = await Promise.all(
    TEXT_TOPICS.map(
      async (t) =>
        [t.id, await hybridSearch(deps.db, deps.embedder, { query: t.query, cik: ctx.cik, k: 3 })] as const,
    ),
  );
  const perTopic = new Map<string, SearchHit[]>(searched);
  const byId = new Map<string, SearchHit>();
  for (const hits of perTopic.values()) for (const h of hits) byId.set(h.id, h);
  if (byId.size === 0) return { findings: [], evidence: [] };

  const topics = TEXT_TOPICS.map(
    (t) =>
      `- ${t.id}: ${t.label} (candidate chunks: ${(perTopic.get(t.id) ?? []).map((h) => h.id).join(", ") || "none"})`,
  ).join("\n");
  const passages = [...byId.values()]
    .map((h) => `[chunk ${h.id}] (10-K Item ${h.section})\n${h.text}`)
    .join("\n\n---\n\n");

  const { data } = await deps.llm.structured({
    node: "forensic.text",
    group: "dp-producer",
    system: loadPrompt("forensic.v1"),
    messages: [
      {
        role: "user",
        content: `Company: ${ctx.companyName}\n\nTopics:\n${topics}\n\nPassages:\n${passages}`,
      },
    ],
    schema,
    schemaName: "forensic_text_disclosures",
    schemaDescription: "Which red-flag topics the passages disclose, each with a verbatim quote.",
    maxTokens: 1500,
    temperature: 0.1,
    maxRetries: 2,
  });

  const rows = await deps.db
    .select({ accession: filings.accession, form: filings.form, filed: filings.filed, url: filings.url })
    .from(filings)
    .where(inArray(filings.accession, [...new Set([...byId.values()].map((h) => h.accession))]));
  const filingBy = new Map(rows.map((r) => [r.accession, r]));

  const findings: Finding[] = [];
  const evidence: Evidence[] = [];
  const seen = new Set<string>();
  for (const d of data.disclosures) {
    const hit = byId.get(d.chunkId);
    const topic = TEXT_TOPICS.find((t) => t.id === d.topic);
    if (!hit || !topic || seen.has(topic.id)) continue;
    const at = hit.text.indexOf(d.quote);
    if (at < 0) continue; // never trust the model: a quote that is not in the chunk is dropped
    seen.add(topic.id);
    const f = filingBy.get(hit.accession);
    const ev: Evidence = {
      id: `filing:${hit.accession}:item${hit.section}:${hit.charStart + at}`,
      kind: "filing_text",
      accession: hit.accession,
      form: f?.form ?? "10-K",
      filed: f?.filed ?? null,
      url: f?.url ?? null,
      section: `Item ${hit.section}`,
      quote: d.quote,
      span: [hit.charStart + at, hit.charStart + at + d.quote.length],
      retrievedAt: new Date().toISOString(),
    };
    evidence.push(ev);
    findings.push({
      id: `forensic:text:${topic.id}:${hit.accession}`,
      agent: "forensic",
      severity: topic.severity,
      title: topic.label,
      detail: d.detail,
      evidenceIds: [ev.id],
      basis: `text:${topic.id}`,
    });
  }
  return { findings, evidence };
}

/** Findings-only form of {@link reviewFilingText}. */
export async function runForensicText(
  deps: { llm: LlmClient; db: Db; embedder: Embedder },
  ctx: { cik: string; companyName: string },
): Promise<Finding[]> {
  return (await reviewFilingText(deps, ctx)).findings;
}
