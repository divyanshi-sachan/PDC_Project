/**
 * `pnpm cli storage smoke` — put → head → get → presigned GET over HTTP → delete,
 * against the real Neon `assets` bucket. Prints only the URL host, never the signature.
 */
import { artifactKey, createArtifactStore } from "@dealpilot/storage";

export async function storageSmoke() {
  const store = createArtifactStore();
  const key = artifactKey(`smoke-${Date.now()}`, "hello.txt");
  const body = `Hello from DealPilot ${new Date().toISOString()}`;

  const put = await store.put(key, body, "text/plain");
  console.log(`▶ put    ${put.key} (${put.size} bytes)`);
  console.log(`▶ exists ${await store.exists(key)}`);

  const got = new TextDecoder().decode(await store.get(key));
  console.log(`▶ get    roundtrip ${got === body ? "matches ✓" : "MISMATCH ✗"}`);
  if (got !== body) throw new Error("storage roundtrip mismatch");

  const url = await store.signedUrl(key, 300);
  const res = await fetch(url);
  const viaUrl = await res.text();
  console.log(
    `▶ signed URL (host ${new URL(url).host}) → HTTP ${res.status}, body ${viaUrl === body ? "matches ✓" : "MISMATCH ✗"}`,
  );
  if (!res.ok || viaUrl !== body) throw new Error("presigned URL fetch failed");

  const anon = await fetch(url.split("?")[0] as string);
  console.log(
    `▶ unsigned URL → HTTP ${anon.status} (private bucket ${anon.status >= 400 ? "✓" : "✗ PUBLIC"})`,
  );

  await store.delete(key);
  console.log(`▶ delete → exists ${await store.exists(key)}`);
  console.log("\n✔ Neon object storage works end to end");
}
