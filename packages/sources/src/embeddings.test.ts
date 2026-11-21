import { EMBEDDING_DIM } from "@dealpilot/db";
import { describe, expect, test } from "vitest";
import { openAiCompatibleEmbedder } from "./embeddings.ts";

const vec = (x: number) => Array.from({ length: EMBEDDING_DIM }, () => x);

function fakeFetch(seen: { url: string; init: RequestInit }[], dim = EMBEDDING_DIM): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    const input = JSON.parse(init.body as string).input as string[];
    // return out of order to prove index sorting
    const data = input
      .map((_, i) => ({ index: i, embedding: Array.from({ length: dim }, () => i) }))
      .reverse();
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("openAiCompatibleEmbedder", () => {
  test("posts model/input/dimensions with bearer auth, batches and orders by index", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const e = openAiCompatibleEmbedder({
      baseUrl: "http://x:4001/",
      apiKey: "k",
      model: "dp-embed",
      fetchImpl: fakeFetch(seen),
      batchSize: 2,
    });
    const out = await e.embed(["a", "b", "c"], "document");
    expect(out).toHaveLength(3);
    expect(out[1]?.[0]).toBe(1);
    expect(seen).toHaveLength(2);
    expect(seen[0]?.url).toBe("http://x:4001/v1/embeddings");
    expect(new Headers(seen[0]?.init.headers).get("authorization")).toBe("Bearer k");
    expect(JSON.parse(seen[0]?.init.body as string)).toEqual({
      model: "dp-embed",
      input: ["a", "b"],
      dimensions: EMBEDDING_DIM,
    });
    expect(vec(0)).toHaveLength(e.dim);
  });

  test("rejects wrong dimensions and HTTP errors", async () => {
    const bad = openAiCompatibleEmbedder({
      baseUrl: "http://x",
      apiKey: "k",
      model: "m",
      fetchImpl: fakeFetch([], 8),
    });
    await expect(bad.embed(["a"], "query")).rejects.toThrow(/dim 8/);
    const err = openAiCompatibleEmbedder({
      baseUrl: "http://x",
      apiKey: "k",
      model: "m",
      fetchImpl: (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
    });
    await expect(err.embed(["a"], "query")).rejects.toThrow(/500/);
  });
});
