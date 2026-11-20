#!/usr/bin/env node
// PostToolUse (Edit|Write|MultiEdit): format edited files (Biome for TS/JS,
// ruff for services/*.py) and enforce purity of packages/finance
// (exit 2 = feedback to the agent).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { block, financeViolations, isFinanceSource, readPayload, relToProject } from "./lib.mjs";

const file = readPayload().tool_input?.file_path;
if (!file || !existsSync(file)) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const rel = relToProject(file);

if (/\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|css)$/.test(rel)) {
  const biome = path.join(root, "node_modules", ".bin", "biome");
  if (existsSync(biome)) {
    spawnSync(biome, ["check", "--write", "--no-errors-on-unmatched", file], { cwd: root, timeout: 60_000 });
  }
}

// Python services: ruff via the service's own uv project (services/<name>/pyproject.toml).
const svc = rel.match(/^services\/([^/]+)\/.*\.py$/);
if (svc) {
  const svcDir = path.join(root, "services", svc[1]);
  const hasUv = spawnSync("uv", ["--version"]).status === 0;
  if (hasUv && existsSync(path.join(svcDir, "pyproject.toml"))) {
    for (const args of [
      ["format", file],
      ["check", "--fix", "--quiet", file],
    ]) {
      spawnSync("uv", ["run", "--quiet", "ruff", ...args], { cwd: svcDir, timeout: 60_000 });
    }
  }
}

if (isFinanceSource(rel)) {
  const problems = financeViolations(readFileSync(file, "utf8"));
  if (problems.length) {
    block(
      `${rel}: packages/finance must be pure & deterministic — found: ${problems.join(", ")}. ` +
        "Move I/O, time, env and LLM calls to packages/sources, packages/agents or apps/*.",
    );
  }
}
