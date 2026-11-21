#!/usr/bin/env node
// Run a command against a Neon branch WITHOUT touching .env:
//   node scripts/with-neon-branch.mjs m2-dev -- pnpm db:migrate
// Sets DATABASE_URL (pooled), DATABASE_URL_UNPOOLED (direct) and TEST_DATABASE_URL for the child only.
import { spawn, spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
const branch = argv[0];
const cmd = sep === -1 ? [] : argv.slice(sep + 1);
if (!branch || branch === "--" || cmd.length === 0) {
  console.error("usage: node scripts/with-neon-branch.mjs <branch> -- <command...>");
  process.exit(2);
}

function connectionString(extra = []) {
  const r = spawnSync("neon", ["connection-string", branch, ...extra], { encoding: "utf8" });
  const out = r.stdout.trim().split("\n").pop() ?? "";
  if (r.status !== 0 || !out.startsWith("postgres")) {
    console.error(`could not get connection string for branch "${branch}" (is \`neon login\` done?)`);
    process.exit(1);
  }
  return out;
}

const direct = connectionString();
const pooled = connectionString(["--pooled"]);
console.error(
  `→ running on Neon branch "${branch}" (host ${new URL(pooled).hostname.replace(/^[^.]+/, "***")})`,
);

const child = spawn(cmd[0], cmd.slice(1), {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: pooled,
    DATABASE_URL_UNPOOLED: direct,
    TEST_DATABASE_URL: pooled,
    NEON_BRANCH: branch,
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
