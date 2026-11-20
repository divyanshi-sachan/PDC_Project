#!/usr/bin/env node
// PreToolUse (Bash): block destructive or cost-risky commands.
import { block, readPayload } from "./lib.mjs";

const RULES = [
  [/git\s+push\s+.*(--force|-f\b)/, "force push is not allowed"],
  [/git\s+reset\s+--hard/, "hard reset discards work — ask the user first"],
  [/rm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+(\/|~|\$HOME|\.\s*$|\*)/, "broad recursive delete"],
  [/(cat|less|head|tail|grep|bat)\s+[^|;&]*\.env(\s|$)/, "do not read .env; use .env.example"],
  [/rm\s+.*evals\/golden/, "eval ground truth is protected"],
  [/drizzle-kit\s+(drop|push\s+.*--force)/, "destructive DB schema command — ask the user first"],
];

// Live = real (possibly paid) API calls.
const LIVE = /(test:live|\.live\.test|eval\b.*--live|DEALPILOT_LIVE=1|pytest\b.*-m\s*["']?live)/;

const cmd = readPayload().tool_input?.command ?? "";
for (const [re, why] of RULES) if (re.test(cmd)) block(`Blocked: ${why}. Command: ${cmd}`);
if (LIVE.test(cmd) && process.env.DEALPILOT_ALLOW_LIVE !== "1") {
  block(
    "Blocked: live evals/tests spend real API credits or free-tier quota. " +
      "Ask the user, then re-run with DEALPILOT_ALLOW_LIVE=1 set in their shell.",
  );
}
