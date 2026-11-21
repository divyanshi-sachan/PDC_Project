#!/usr/bin/env node
// Start services/edgar locally with env loaded from .env.local / .env (same parser as the TS apps).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: [path.join(root, ".env.local"), path.join(root, ".env")], quiet: true });

if (!process.env.SEC_USER_AGENT) {
  console.error('SEC_USER_AGENT is not set in .env (format: "DealPilot you@example.com")');
  process.exit(1);
}
const port = process.env.EDGAR_PORT ?? "8100";
const child = spawn(
  "uv",
  ["run", "fastapi", "dev", "src/edgar_service/main.py", "--host", "127.0.0.1", "--port", port],
  {
    cwd: path.join(root, "services", "edgar"),
    stdio: "inherit",
    env: {
      ...process.env,
      EDGAR_CACHE_DIR: process.env.EDGAR_CACHE_DIR ?? path.join(root, "data/cache/edgar"),
    },
  },
);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
