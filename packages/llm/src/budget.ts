import { BudgetExceededError, type LlmUsage } from "./types.ts";

/** Per-task spending cap. `check()` before a call, `record()` after. */
export class Budget {
  #spent = 0;
  #inputTokens = 0;
  #outputTokens = 0;
  readonly limitUsd: number;

  constructor(limitUsd: number) {
    this.limitUsd = limitUsd;
  }

  get spentUsd() {
    return this.#spent;
  }
  get remainingUsd() {
    return Math.max(0, this.limitUsd - this.#spent);
  }
  get inputTokens() {
    return this.#inputTokens;
  }
  get outputTokens() {
    return this.#outputTokens;
  }

  check(): void {
    if (this.#spent >= this.limitUsd) throw new BudgetExceededError(this.#spent, this.limitUsd);
  }

  record(u: Pick<LlmUsage, "costUsd" | "inputTokens" | "outputTokens">): void {
    this.#spent += u.costUsd;
    this.#inputTokens += u.inputTokens;
    this.#outputTokens += u.outputTokens;
  }
}
