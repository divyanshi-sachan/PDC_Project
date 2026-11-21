import type { z } from "zod";

/** LiteLLM model groups (see infra/litellm/config.yaml). App code never names a provider model. */
export type ModelGroup = "dp-producer" | "dp-producer-paid" | "dp-verifier" | "dp-verifier-budget";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmUsage {
  node: string;
  group: ModelGroup;
  /** Concrete model that served the call, as reported by LiteLLM. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  attempt: number;
}

export interface StructuredRequest<T> {
  /** Agent node name — recorded in traces and cost accounting. */
  node: string;
  group: ModelGroup;
  system: string;
  messages: LlmMessage[];
  schema: z.ZodType<T>;
  /** Function name given to the model (snake_case). */
  schemaName: string;
  schemaDescription?: string;
  /** Extra attempts after a validation failure (default 1). */
  maxRetries?: number;
  temperature?: number;
  maxTokens?: number;
}

export interface StructuredResult<T> {
  data: T;
  usage: LlmUsage[];
}

export interface TextRequest {
  node: string;
  group: ModelGroup;
  system: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface TextResult {
  text: string;
  usage: LlmUsage;
}

/** Every LLM call in DealPilot goes through this interface. */
export interface LlmClient {
  structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  text(req: TextRequest): Promise<TextResult>;
}

export class BudgetExceededError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly limitUsd: number,
  ) {
    super(`LLM budget exceeded: spent $${spentUsd.toFixed(4)} of $${limitUsd.toFixed(2)}`);
  }
}

export class StructuredOutputError extends Error {
  constructor(
    readonly node: string,
    readonly attempts: number,
    readonly lastError: string,
  ) {
    super(`${node}: model output failed validation after ${attempts} attempt(s): ${lastError}`);
  }
}
