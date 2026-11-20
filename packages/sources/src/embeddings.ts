import { EMBEDDING_DIM } from "@dealpilot/db";

export type EmbedKind = "document" | "query";

export interface Embedder {
  readonly model: string;
  readonly dim: number;
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
}

function checkDims(model: string, vectors: number[][], n: number): number[][] {
  if (vectors.length !== n) throw new Error(`${model}: expected ${n} embeddings, got ${vectors.length}`);
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIM) {
      throw new Error(`${model}: embedding dim ${v.length} != EMBEDDING_DIM ${EMBEDDING_DIM}`);
    }
  }
  return vectors;
}

type FetchLike = typeof fetch;

/** Voyage AI (free tier: 200M tokens on voyage-4 family). */
export function voyageEmbedder(opts: {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
  batchSize?: number;
}): Embedder {
  const model = opts.model ?? "voyage-4-lite";
  const f = opts.fetchImpl ?? fetch;
  const batchSize = opts.batchSize ?? 64;
  return {
    model,
    dim: EMBEDDING_DIM,
    async embed(texts, kind) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const res = await f("https://api.voyageai.com/v1/embeddings", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify({ model, input: batch, input_type: kind, output_dimension: EMBEDDING_DIM }),
        });
        if (!res.ok) throw new Error(`voyage ${res.status}: ${await res.text()}`);
        const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
        const sorted = [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
        out.push(...checkDims(model, sorted, batch.length));
      }
      return out;
    },
  };
}

/** Local Ollama (e.g. `ollama pull qwen3-embedding:0.6b`, 1024-dim). No data leaves the machine. */
export function ollamaEmbedder(opts: { baseUrl?: string; model?: string; fetchImpl?: FetchLike }): Embedder {
  const model = opts.model ?? "qwen3-embedding:0.6b";
  const base = opts.baseUrl ?? "http://localhost:11434";
  const f = opts.fetchImpl ?? fetch;
  return {
    model,
    dim: EMBEDDING_DIM,
    async embed(texts, kind) {
      // Qwen3-Embedding expects an instruction prefix on queries only.
      const input =
        kind === "query"
          ? texts.map(
              (t) => `Instruct: Retrieve passages from SEC filings that answer the query\nQuery: ${t}`,
            )
          : texts;
      const res = await f(`${base}/api/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, input }),
      });
      if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { embeddings: number[][] };
      return checkDims(model, json.embeddings, texts.length);
    },
  };
}

/**
 * Deterministic hashed bag-of-words embedder for tests and offline dev.
 * Similar texts get similar vectors; never use in production.
 */
export function fakeEmbedder(): Embedder {
  return {
    model: "fake-hash-bow",
    dim: EMBEDDING_DIM,
    async embed(texts) {
      return texts.map((t) => {
        const v = new Array<number>(EMBEDDING_DIM).fill(0);
        for (const w of t.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
          let h = 2166136261;
          for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
          const idx = (h >>> 0) % EMBEDDING_DIM;
          v[idx] = (v[idx] as number) + 1;
        }
        const norm = Math.hypot(...v) || 1;
        return v.map((x) => x / norm);
      });
    },
  };
}
