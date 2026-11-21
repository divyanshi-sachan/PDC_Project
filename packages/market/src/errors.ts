export type MarketDataErrorCode =
  | "not_found"
  | "plan_limited"
  | "rate_limited"
  | "upstream_error"
  | "invalid_response";

/** Typed failure for every market-data adapter. Messages never contain API keys. */
export class MarketDataError extends Error {
  readonly code: MarketDataErrorCode;
  readonly status: number | null;

  constructor(code: MarketDataErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "MarketDataError";
    this.code = code;
    this.status = status;
  }
}
