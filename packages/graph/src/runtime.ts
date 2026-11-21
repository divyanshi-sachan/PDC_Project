import { createMarketView, type MarketApi } from "@dealpilot/agents";
import { type Budget, createLlmClient, type LlmClient, type LlmUsage } from "@dealpilot/llm";
import {
  cachedPriceProvider,
  chainPriceProviders,
  createFinnhubClient,
  createMarketClient,
  type IndustryBetaTable,
  loadDamodaranBetas,
  memoryCache,
  priceProvidersFromEnv,
} from "@dealpilot/market";
import {
  createEdgarClient,
  type EdgarClient,
  type Embedder,
  openAiCompatibleEmbedder,
} from "@dealpilot/sources";

export interface RuntimeEnv {
  LITELLM_BASE_URL?: string | undefined;
  LITELLM_MASTER_KEY?: string | undefined;
  EDGAR_SERVICE_URL?: string | undefined;
  EDGAR_SERVICE_KEY?: string | undefined;
  FMP_API_KEY?: string | undefined;
  /** Comma-separated price provider order, e.g. "fmp,finnhub,twelvedata". */
  PRICE_PROVIDERS?: string | undefined;
  FINNHUB_API_KEY?: string | undefined;
  TWELVEDATA_API_KEY?: string | undefined;
  MAX_COST_PER_TASK_USD?: string | undefined;
}

export interface Runtime {
  edgar: EdgarClient;
  /** Damodaran US industry betas (committed snapshot). */
  industryBetas: IndustryBetaTable;
  market: MarketApi;
  embedder: Embedder;
  /** Per-turn spending cap in USD. */
  maxCostUsd: number;
  /** An LLM client whose spend is tracked on `budget` and reported through `onUsage`. */
  llmFor(budget: Budget, onUsage?: (u: LlmUsage) => void | Promise<void>): LlmClient;
}

function required(env: RuntimeEnv, k: keyof RuntimeEnv): string {
  const v = env[k];
  if (!v) throw new Error(`${k} is not set (see .env.example)`);
  return v;
}

/** The real service clients (SEC data service, LiteLLM gateway, FMP, embeddings), shared by the worker and the CLI. */
export function createRuntime(env: RuntimeEnv): Runtime {
  const baseUrl = env.LITELLM_BASE_URL ?? "http://localhost:4001";
  const apiKey = required(env, "LITELLM_MASTER_KEY");
  const edgar = createEdgarClient({
    baseUrl: env.EDGAR_SERVICE_URL ?? "http://localhost:8100",
    ...(env.EDGAR_SERVICE_KEY ? { serviceKey: env.EDGAR_SERVICE_KEY } : {}),
  });
  // FMP supplies the Treasury yield and best-effort profile/peers; prices come from the configured chain
  // (PRICE_PROVIDERS, default fmp → finnhub → twelvedata, skipping any provider without a key).
  const cache = memoryCache();
  const fmp = createMarketClient({ fmpApiKey: required(env, "FMP_API_KEY"), cache });
  const finnhub = env.FINNHUB_API_KEY
    ? createFinnhubClient({ apiKey: env.FINNHUB_API_KEY, cache })
    : undefined;
  const { providers } = priceProvidersFromEnv(env, { fmp });
  const prices = cachedPriceProvider(chainPriceProviders(providers), cache);
  return {
    edgar,
    industryBetas: loadDamodaranBetas(),
    market: createMarketView({
      edgar,
      prices,
      fmp,
      ...(finnhub ? { finnhub } : {}),
    }),
    embedder: openAiCompatibleEmbedder({ baseUrl, apiKey, model: "dp-embed" }),
    maxCostUsd: Number(env.MAX_COST_PER_TASK_USD ?? 0.5),
    llmFor: (budget, onUsage) =>
      createLlmClient({ baseUrl, apiKey, budget, ...(onUsage ? { onUsage } : {}) }),
  };
}
