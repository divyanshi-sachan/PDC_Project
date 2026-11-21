import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import { generateKeyPair, type JWTVerifyGetKey, SignJWT } from "jose";

export const ISSUER = "https://auth.example.test";

export async function makeKeys() {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const other = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const jwks: JWTVerifyGetKey = async () => pair.publicKey;
  const sign = (
    sub: string,
    o: { exp?: string | number; iss?: string | null; key?: "own" | "other"; email?: string } = {},
  ) => {
    const jwt = new SignJWT(o.email ? { email: o.email } : {})
      .setProtectedHeader({ alg: "EdDSA" })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime(o.exp ?? "10m");
    if (o.iss !== null) jwt.setIssuer(o.iss ?? ISSUER);
    return jwt.sign(o.key === "other" ? other.privateKey : pair.privateKey);
  };
  return { jwks, sign };
}

export async function listen(
  app: Express,
): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

export interface SseMessage {
  id?: string;
  event?: string;
  data?: string;
  comment?: string;
}

/** Minimal SSE reader over fetch streaming. */
export async function openSse(url: string, init: RequestInit = {}) {
  const ctrl = new AbortController();
  const res = await fetch(url, { ...init, signal: ctrl.signal });
  const msgs: SseMessage[] = [];
  const waiters: Array<() => void> = [];
  const done = (async () => {
    if (!res.body) return;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    try {
      for (;;) {
        const { value, done: d } = await reader.read();
        if (d) break;
        buf += value;
        let i = buf.indexOf("\n\n");
        while (i !== -1) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const m: SseMessage = {};
          for (const line of block.split("\n")) {
            if (line.startsWith(":")) m.comment = line.slice(1).trim();
            else if (line.startsWith("id: ")) m.id = line.slice(4);
            else if (line.startsWith("event: ")) m.event = line.slice(7);
            else if (line.startsWith("data: ")) m.data = line.slice(6);
          }
          if (m.id !== undefined || m.comment !== undefined) msgs.push(m);
          for (const w of waiters.splice(0)) w();
          i = buf.indexOf("\n\n");
        }
      }
    } catch {
      /* aborted */
    }
  })();
  async function until(pred: (m: SseMessage[]) => boolean, ms = 5000) {
    const start = Date.now();
    while (!pred(msgs)) {
      if (Date.now() - start > ms) throw new Error(`timeout; got ${JSON.stringify(msgs)}`);
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }
  return { res, msgs, until, abort: () => ctrl.abort(), done };
}
