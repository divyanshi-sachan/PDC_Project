/**
 * DealPilot dev CLI.
 *   pnpm cli facts AAPL            # key reported facts with SEC citations (needs edgar-service running)
 *   pnpm cli facts AAPL --form 10-Q
 */

import { parseArgs } from "node:util";
import type { Fact } from "@dealpilot/shared";
import { config } from "dotenv";
import { authSmoke } from "./auth.ts";
import { chatLocal } from "./chat.ts";
import { e2e } from "./e2e.ts";
import { llmSmoke } from "./llm.ts";
import { storageSmoke } from "./storage.ts";

// `.env.local` (neon env pull) overrides `.env`.
config({ path: [".env.local", ".env"], quiet: true });

import { createEdgarClient, EdgarServiceError, toFact } from "@dealpilot/sources";

/** Concepts with common fallbacks (companies tag the same line item differently). */
export const KEY_CONCEPTS: { label: string; concepts: string[] }[] = [
  {
    label: "Revenue",
    concepts: ["us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "us-gaap:Revenues"],
  },
  { label: "Operating income", concepts: ["us-gaap:OperatingIncomeLoss"] },
  { label: "Net income", concepts: ["us-gaap:NetIncomeLoss"] },
  { label: "Operating cash flow", concepts: ["us-gaap:NetCashProvidedByUsedInOperatingActivities"] },
  { label: "Capex", concepts: ["us-gaap:PaymentsToAcquirePropertyPlantAndEquipment"] },
  { label: "Cash & equivalents", concepts: ["us-gaap:CashAndCashEquivalentsAtCarryingValue"] },
  {
    label: "Diluted shares (wtd avg)",
    concepts: ["us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding"],
  },
];

const fmt = (f: Fact) =>
  f.unit === "USD"
    ? `$${(f.value / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })}m`
    : `${(f.value / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}m ${f.unit}`;

async function facts(ticker: string, form: string, years: number) {
  const client = createEdgarClient({
    baseUrl: process.env.EDGAR_SERVICE_URL ?? "http://localhost:8100",
    ...(process.env.EDGAR_SERVICE_KEY ? { serviceKey: process.env.EDGAR_SERVICE_KEY } : {}),
  });
  const company = await client.company(ticker);
  console.log(`${company.name} (${company.ticker}) · CIK ${company.cik} · SIC ${company.sic ?? "n/a"}\n`);
  const now = new Date().toISOString();

  for (const { label, concepts } of KEY_CONCEPTS) {
    let rows: Fact[] = [];
    for (const concept of concepts) {
      try {
        const res = await client.facts(ticker, { concept, form });
        rows = res.facts
          .map((f) => toFact(company.cik, f, now))
          // annual durations (~1y) or balance-sheet instants
          .filter((f) => form !== "10-K" || f.period.start === null || f.period.fiscalPeriod === "FY")
          .sort((a, b) => b.period.end.localeCompare(a.period.end))
          .slice(0, years);
        if (rows.length) break;
      } catch (e) {
        if (e instanceof EdgarServiceError && e.status === 404) continue;
        throw e;
      }
    }
    console.log(`${label}`);
    if (!rows.length) console.log("  (not reported under known concepts)");
    for (const f of rows) {
      const ev = f.evidence;
      const flag = f.restated ? "  [restated]" : "";
      console.log(
        `  ${f.period.end}  ${fmt(f).padStart(14)}   ${f.concept}  ← ${ev.form} ${ev.accession} filed ${ev.filed}${flag}`,
      );
    }
  }
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      form: { type: "string", default: "10-K" },
      years: { type: "string", default: "3" },
      email: { type: "string" },
    },
  });
  const [cmd, arg] = positionals;
  if (cmd === "facts" && arg) return facts(arg.toUpperCase(), values.form, Number(values.years));
  if (cmd === "auth" && arg === "smoke") return authSmoke(values.email);
  if (cmd === "storage" && arg === "smoke") return storageSmoke();
  if (cmd === "llm" && arg === "smoke") return llmSmoke();
  if (cmd === "chat" && arg) return chatLocal(positionals.slice(1));
  if (cmd === "e2e" && arg) return e2e(positionals.slice(1));
  console.error(
    'usage:\n  pnpm cli facts <TICKER> [--form 10-K|10-Q] [--years 3]\n  pnpm cli auth smoke [--email x]\n  pnpm cli storage smoke\n  pnpm cli llm smoke\n  pnpm cli chat "<message>" ["<message>" ...]',
  );
  process.exitCode = 2;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
