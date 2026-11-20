#!/usr/bin/env node
// PreToolUse (Edit|Write|MultiEdit|NotebookEdit): block writes to secrets,
// eval ground truth and the raw source-document cache.
import { block, readPayload, relToProject } from "./lib.mjs";

const RULES = [
  [/(^|\/)\.env($|\.(?!example$)[^/]+$)/, "secrets file (.env*) — edit .env.example instead"],
  [/\.(pem|key|p12)$/, "private key material"],
  [/(^|\/)[^/]*secret[^/]*$/i, "file name contains 'secret'"],
  [/(^|\/)evals\/golden\//, "eval ground truth — only change when the user explicitly asks"],
  [/(^|\/)data\/raw\//, "immutable source-document cache"],
];

const { tool_input: input = {} } = readPayload();
const p = input.file_path || input.notebook_path;
if (p) {
  const rel = relToProject(p);
  for (const [re, why] of RULES) {
    if (!re.test(rel)) continue;
    if (rel.includes("evals/golden/") && process.env.DEALPILOT_ALLOW_GOLDEN === "1") break;
    block(`Blocked write to ${rel}: ${why}.`);
  }
}
