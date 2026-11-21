import { type Db, filings, inArray } from "@dealpilot/db";
import type { LlmClient } from "@dealpilot/llm";
import type { Citation, Evidence } from "@dealpilot/shared";
import { type Embedder, hybridSearch, type SearchHit } from "@dealpilot/sources";
import { z } from "zod";
import { loadPrompt } from "./prompts.ts";

export interface AnswerResult {
  text: string;
  citations: Citation[];
  evidence: Evidence[];
}

const norm = (s: string) => s.replace(/,/g, "");
/** Numeric tokens (e.g. "12.5", "3,200") in a string. */
const numbersIn = (s: string) => (norm(s).match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => n.length > 0);

/**
 * Answer a question from retrieved 10-K chunks only. The model must quote verbatim; code verifies that
 * each quote exists in the chunk it cites and that every number in the answer appears in the cited text.
 */
export async function answerFromFilings(
  deps: { llm: LlmClient; db: Db; embedder: Embedder },
  ctx: { cik: string; companyName: string; question: string },
): Promise<AnswerResult> {
  const hits = await hybridSearch(deps.db, deps.embedder, { query: ctx.question, cik: ctx.cik, k: 6 });
  if (hits.length === 0) {
    return {
      text: "I couldn't find that in the indexed sections of the latest 10-K (Items 1, 1A and 7).",
      citations: [],
      evidence: [],
    };
  }
  const byId = new Map(hits.map((h) => [h.id, h]));
  const ids = hits.map((h) => h.id);

  const schema = z
    .object({
      answer: z.string().min(1).max(1200),
      citations: z
        .array(z.object({ chunkId: z.string(), quote: z.string().min(8).max(400) }))
        .min(1)
        .max(4),
    })
    .superRefine((v, c) => {
      const cited = new Set<string>();
      v.citations.forEach((cit, k) => {
        const hit = byId.get(cit.chunkId);
        if (!hit)
          c.addIssue({
            code: "custom",
            message: `citations[${k}].chunkId must be one of: ${ids.join(", ")}`,
          });
        else if (!hit.text.includes(cit.quote))
          c.addIssue({
            code: "custom",
            message: `citations[${k}].quote must be copied verbatim from chunk ${cit.chunkId}`,
          });
        else cited.add(hit.text);
      });
      const source = norm([...cited].join(" "));
      for (const n of numbersIn(v.answer)) {
        if (!source.includes(n))
          c.addIssue({
            code: "custom",
            message: `the number ${n} in the answer does not appear in the cited text; remove it or cite the passage that contains it`,
          });
      }
    });

  const context = hits.map((h) => `[chunk ${h.id}] (10-K Item ${h.section})\n${h.text}`).join("\n\n---\n\n");
  const { data } = await deps.llm.structured({
    node: "research.answer",
    group: "dp-producer",
    system: loadPrompt("answer.v1"),
    messages: [
      {
        role: "user",
        content: `Company: ${ctx.companyName}\nQuestion: ${ctx.question}\n\nPassages:\n${context}`,
      },
    ],
    schema,
    schemaName: "answer_from_filing",
    schemaDescription: "Answer using only the passages, with verbatim quotes.",
    maxTokens: 900,
    temperature: 0.1,
    maxRetries: 2,
  });

  const rows = await deps.db
    .select({ accession: filings.accession, form: filings.form, filed: filings.filed, url: filings.url })
    .from(filings)
    .where(inArray(filings.accession, [...new Set(hits.map((h) => h.accession))]));
  const filingBy = new Map(rows.map((r) => [r.accession, r]));

  const evidence: Evidence[] = data.citations.map((cit) => {
    const hit = byId.get(cit.chunkId) as SearchHit;
    const f = filingBy.get(hit.accession);
    const at = hit.text.indexOf(cit.quote);
    return {
      id: `filing:${hit.accession}:item${hit.section}:${hit.charStart + at}`,
      kind: "filing_text",
      accession: hit.accession,
      form: f?.form ?? "10-K",
      filed: f?.filed ?? null,
      url: f?.url ?? null,
      section: `Item ${hit.section}`,
      quote: cit.quote,
      span: [hit.charStart + at, hit.charStart + at + cit.quote.length],
      retrievedAt: new Date().toISOString(),
    };
  });
  return {
    text: data.answer,
    citations: evidence.map((e, k) => ({
      evidenceId: e.id,
      label: `${e.form ?? "10-K"} ${e.section ?? ""} [${k + 1}]`.trim(),
    })),
    evidence,
  };
}
