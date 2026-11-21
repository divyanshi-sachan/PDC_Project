import { createDb, createThreadEventHub, directDatabaseUrl, pooledDatabaseUrl } from "@dealpilot/db";
import { CHAT_TURN_QUEUE, type ChatTurnJob } from "@dealpilot/shared";
import { createArtifactStore } from "@dealpilot/storage";
import { config } from "dotenv";
import { createRemoteJWKSet } from "jose";
import { PgBoss } from "pg-boss";
import { createApp } from "./server.ts";

config({ path: [".env.local", ".env"], quiet: true });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (see .env.example)`);
  return v;
}

const port = Number(process.env.API_PORT ?? 4000);
const webOrigins = (process.env.WEB_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const direct = directDatabaseUrl();
const { db, close: closeDb } = createDb(pooledDatabaseUrl());
const hub = createThreadEventHub({ listenUrl: direct });

// The API only enqueues; the worker owns maintenance/scheduling. pg-boss uses the direct URL.
const boss = new PgBoss({ connectionString: direct, max: 2, supervise: false, schedule: false });
boss.on("error", (e) => console.error("[api] pg-boss error:", e.message));
await boss.start();
await boss.createQueue(CHAT_TURN_QUEUE);

const store = createArtifactStore();

const app = createApp({
  db,
  hub,
  jwks: createRemoteJWKSet(new URL(required("NEON_AUTH_JWKS_URL"))),
  issuer: new URL(required("NEON_AUTH_BASE_URL")).origin,
  webOrigins,
  signedUrl: (key) => store.signedUrl(key, 300),
  enqueue: async (job: ChatTurnJob) => {
    // singletonKey = user message id makes a retried POST/enqueue idempotent.
    await boss.send(CHAT_TURN_QUEUE, job, { singletonKey: job.messageId });
  },
});

const server = app.listen(port, () => console.error(`[api] listening on :${port}`));

const shutdown = async () => {
  server.closeAllConnections();
  server.close();
  await Promise.allSettled([hub.close(), boss.stop({ graceful: false }), closeDb()]);
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
