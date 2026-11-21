#!/usr/bin/env node
// Start the LiteLLM proxy locally with env loaded from .env.local / .env.
//   pnpm dev:litellm            (port from LITELLM_PORT, default 4001)
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: [path.join(root, ".env.local"), path.join(root, ".env")], quiet: true });

if (!process.env.LITELLM_MASTER_KEY) {
  console.error("LITELLM_MASTER_KEY is not set in .env");
  process.exit(1);
}
const port = process.env.LITELLM_PORT ?? "4001";

// LiteLLM must NEVER see our database: if DATABASE_URL is set it tries to create its own tables in it.
// Pass only the provider keys + master key it needs.
const ALLOW = [
  "LITELLM_MASTER_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
];
const env = { PATH: process.env.PATH, HOME: process.env.HOME };
for (const k of ALLOW) if (process.env[k]) env[k] = process.env[k];
const child = spawn(
  "uvx",
  [
    "--python",
    "3.12",
    "--from",
    "litellm[proxy]",
    "litellm",
    "--config",
    path.join(root, "infra/litellm/config.yaml"),
    "--host",
    "127.0.0.1",
    "--port",
    port,
  ],
  { cwd: root, stdio: "inherit", env },
);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
