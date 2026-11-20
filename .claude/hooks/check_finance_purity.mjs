#!/usr/bin/env node
// CLI used by lefthook/CI: node check_finance_purity.mjs <files...>
import { readFileSync } from "node:fs";
import { financeViolations, isFinanceSource } from "./lib.mjs";

let failed = false;
for (const f of process.argv.slice(2)) {
  if (!isFinanceSource(f)) continue;
  const problems = financeViolations(readFileSync(f, "utf8"));
  if (problems.length) {
    failed = true;
    console.error(`${f}: ${problems.join(", ")}`);
  }
}
process.exit(failed ? 1 : 0);
