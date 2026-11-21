/**
 * `pnpm cli e2e "<message>" ["<message2>" ...]` — end-to-end through the REAL HTTP API and worker:
 * sign up a throwaway Neon Auth user → get a JWT → create a thread → post messages → read the SSE stream
 * until each turn is `done` → print the stored messages. Needs `apps/api` (API_URL, default :4000) and
 * `apps/worker` running. Never prints the token.
 */
import { randomBytes } from "node:crypto";
import { cookieJarContext, createDealpilotAuth } from "@dealpilot/auth";
import type { ChatEvent, Message } from "@dealpilot/shared";
import { ChatEventSchema } from "@dealpilot/shared";

async function token(): Promise<string> {
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  if (!baseUrl) throw new Error("NEON_AUTH_BASE_URL missing");
  const { ctx } = cookieJarContext("http://localhost:3000");
  const auth = createDealpilotAuth({
    baseUrl,
    cookieSecret: process.env.NEON_AUTH_COOKIE_SECRET ?? randomBytes(32).toString("base64"),
    context: () => ctx,
  });
  const email = `dealpilot.e2e+${Date.now()}@example.com`;
  const up = await auth.signUp.email({ email, password: randomBytes(18).toString("base64url"), name: "E2E" });
  if (up.error) throw new Error(`sign-up failed: ${up.error.message}`);
  // The upstream auth service mints a short-lived JWT for the signed-in session at GET /token.
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/token`, {
    headers: { cookie: await ctx.getCookies(), origin: "http://localhost:3000" },
  });
  const body = (await res.json().catch(() => null)) as { token?: string } | null;
  if (!res.ok || !body?.token) throw new Error(`could not get a JWT (HTTP ${res.status})`);
  return body.token;
}

async function readUntilDone(
  res: Response,
  onEvent: (e: ChatEvent, id: string | null) => void,
): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no SSE body");
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i = buf.indexOf("\n\n");
    while (i !== -1) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      i = buf.indexOf("\n\n");
      const id = /^id: (.*)$/m.exec(block)?.[1] ?? null;
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (!data) continue;
      const parsed = ChatEventSchema.safeParse(JSON.parse(data));
      if (!parsed.success) throw new Error(`bad event on the wire: ${parsed.error.message.slice(0, 200)}`);
      onEvent(parsed.data, id);
      if (parsed.data.type === "done") {
        await reader.cancel();
        return;
      }
    }
  }
}

export async function e2e(messages: string[]) {
  const api = process.env.API_URL ?? "http://localhost:4000";
  const jwt = await token();
  const headers = { authorization: `Bearer ${jwt}`, "content-type": "application/json" };
  const j = async <T>(r: Response): Promise<T> => {
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return (await r.json()) as T;
  };

  console.log(`API health: ${(await fetch(`${api}/healthz`)).status}`);
  const noAuth = await fetch(`${api}/threads`);
  console.log(`GET /threads without a token → ${noAuth.status} (expected 401)`);

  const thread = await j<{ id: string }>(
    await fetch(`${api}/threads`, { method: "POST", headers, body: "{}" }),
  );
  console.log(`thread ${thread.id}`);

  let lastId = "0";
  for (const text of messages) {
    console.log(`\n━━ USER: ${text}`);
    const t0 = Date.now();
    const posted = await j<{ assistantMessage: Message }>(
      await fetch(`${api}/threads/${thread.id}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text }),
      }),
    );
    console.log(
      `  202 queued; assistant message ${posted.assistantMessage.id.slice(0, 8)}… status ${posted.assistantMessage.status}`,
    );
    const sse = await fetch(`${api}/threads/${thread.id}/events?after=${lastId}`, {
      headers: { authorization: `Bearer ${jwt}`, accept: "text/event-stream" },
    });
    await readUntilDone(sse, (e, id) => {
      if (id) lastId = id;
      if (e.type === "step")
        console.log(
          `  ${e.status === "started" ? "▸" : e.status === "done" ? "✓" : "✗"} [${e.node}] ${e.label}${e.detail ? ` — ${e.detail}` : ""}`,
        );
      else if (e.type === "panel")
        console.log(
          `  ┌ PANEL ${e.panel.ticker} DCF $${e.panel.valuation.perShare.toFixed(2)}/sh, ${e.panel.comps.peers.length} peers, ${e.panel.assumptions.length} assumptions`,
        );
      else if (e.type === "message") console.log(`  ASSISTANT: ${e.text.split("\n")[0]}`);
      else if (e.type === "cost") console.log(`  💲 $${e.costUsd.toFixed(4)}`);
      else if (e.type === "error") console.log(`  ✗ ERROR ${e.code}: ${e.message}`);
    });
    console.log(`  ⏱ ${((Date.now() - t0) / 1000).toFixed(1)}s (queue → worker → SSE)`);
  }

  const stored = await j<Message[]>(await fetch(`${api}/threads/${thread.id}/messages`, { headers }));
  console.log("\nStored messages:");
  for (const m of stored)
    console.log(`  ${m.role.padEnd(9)} ${m.status.padEnd(7)} ${m.text.replace(/\s+/g, " ").slice(0, 110)}`);
}
