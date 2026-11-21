import type { DurationItem, InstantItem } from "./types.ts";

/**
 * Ordered us-gaap concept fallbacks per simple item. First concept whose data reaches the latest fiscal year wins
 * (revenue: the concept with the newest annual period wins, ties broken by this order).
 */
export const SIMPLE_CONCEPTS: Record<
  Exclude<DurationItem | InstantItem, "totalDebt" | "marketableSecurities">,
  readonly string[]
> = {
  revenue: [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
  ],
  ebit: ["OperatingIncomeLoss"],
  depreciationAndAmortization: [
    "DepreciationDepletionAndAmortization",
    "DepreciationAndAmortization",
    "DepreciationAmortizationAndAccretionNet",
    "Depreciation",
  ],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  netIncome: ["NetIncomeLoss", "ProfitLoss"],
  pretaxIncome: [
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
  ],
  incomeTaxExpense: ["IncomeTaxExpenseBenefit"],
  interestExpense: ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt"],
  dilutedShares: ["WeightedAverageNumberOfDilutedSharesOutstanding"],
  basicShares: ["WeightedAverageNumberOfSharesOutstandingBasic"],
  operatingCashFlow: [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ],
  cash: [
    "CashAndCashEquivalentsAtCarryingValue",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
  ],
  receivables: ["AccountsReceivableNetCurrent"],
  inventory: ["InventoryNet"],
  payables: ["AccountsPayableCurrent"],
  totalAssets: ["Assets"],
  equity: ["StockholdersEquity"],
};

/** Marketable securities: tiers of components that are SUMMED; the first tier with data wins. */
export const MARKETABLE_SECURITIES_TIERS: readonly (readonly string[])[] = [
  ["MarketableSecuritiesCurrent", "MarketableSecuritiesNoncurrent"],
  ["AvailableForSaleSecuritiesDebtSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesNoncurrent"],
  ["ShortTermInvestments"],
];

/** Debt components; see `assembleTotalDebt` in history.ts for the double-counting policy. */
export const DEBT_CONCEPTS = {
  total: "LongTermDebt",
  noncurrent: "LongTermDebtNoncurrent",
  currentLtd: "LongTermDebtCurrent",
  debtCurrent: "DebtCurrent",
  commercialPaper: "CommercialPaper",
  shortTermBorrowings: "ShortTermBorrowings",
} as const;

export const DURATION_ITEMS: readonly DurationItem[] = [
  "revenue",
  "ebit",
  "depreciationAndAmortization",
  "capex",
  "netIncome",
  "pretaxIncome",
  "incomeTaxExpense",
  "interestExpense",
  "dilutedShares",
  "basicShares",
  "operatingCashFlow",
];

export const INSTANT_ITEMS: readonly InstantItem[] = [
  "cash",
  "marketableSecurities",
  "totalDebt",
  "receivables",
  "inventory",
  "payables",
  "totalAssets",
  "equity",
];

/** Expected XBRL unit per item. */
export function expectedUnit(item: DurationItem | InstantItem): string {
  return item === "dilutedShares" || item === "basicShares" ? "shares" : "USD";
}
