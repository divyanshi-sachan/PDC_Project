// Shared helpers for Claude Code hooks (Node, no dependencies).
import { readFileSync } from "node:fs";
import path from "node:path";

export function readPayload() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

export function relToProject(p) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return path.isAbsolute(p) ? path.relative(root, p) : p;
}

/** Exit 2 = block the tool call; stderr is shown to the agent. */
export function block(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

// Rules for packages/finance: must stay pure & deterministic.
export const FINANCE_FORBIDDEN = [
  [/from\s+["'](node:)?(fs|fs\/promises|http|https|net|child_process|path)["']/, "Node I/O module"],
  [
    /from\s+["'](openai|@anthropic-ai\/sdk|@langchain\/[^"']+|langchain|ai|@ai-sdk\/[^"']+|@google\/genai|groq-sdk)["']/,
    "LLM/provider SDK",
  ],
  [/from\s+["'](axios|undici|node-fetch|got|ky)["']|\bfetch\s*\(/, "network I/O"],
  [/Math\.random\s*\(/, "randomness"],
  [/Date\.now\s*\(|new Date\s*\(\s*\)/, "wall-clock time"],
  [/process\.env/, "environment access"],
  [/from\s+["']@dealpilot\/[^"']+["']/, "internal package import (finance must be a leaf)"],
];

export function financeViolations(src) {
  return [...new Set(FINANCE_FORBIDDEN.filter(([re]) => re.test(src)).map(([, why]) => why))];
}

export function isFinanceSource(rel) {
  return /(^|\/)packages\/finance\/src\/.*\.ts$/.test(rel) && !/\.test\.ts$/.test(rel);
}
