---
name: run-evals
description: Run DealPilot evaluations (smoke, SECQUE, FailSafeQA, Fin-RATE, BankerToolBench) and interpret accuracy, citation, rubric, risk-detection, consistency, latency and cost metrics. Use when asked to evaluate, benchmark, compare models/prompts, or check for regressions.
---

# Running evals (`evals/`)

| Suite                                             | Command                                 | Cost                        |
| ------------------------------------------------- | --------------------------------------- | --------------------------- |
| Smoke (cached LLM replies)                        | `pnpm eval smoke`                       | free                        |
| SECQUE (565 Qs; extraction, ratios, trends, risk) | `pnpm eval secque --live`               | **live, free-tier or paid** |
| FailSafeQA (220; adversarial, refusal)            | `pnpm eval failsafe --live`             | **live**                    |
| Fin-RATE sample (~250; cross-company, multi-year) | `pnpm eval finrate --live --sample 250` | **live**                    |
| Restatement slice (internal, ~20)                 | `pnpm eval restate --live`              | **live, cheap**             |
| BankerToolBench (100 tasks)                       | `pnpm eval btb --live --tasks 1-10`     | **live, expensive**         |

- Live runs need `DEALPILOT_ALLOW_LIVE=1` (the Bash hook enforces this). **Ask the user before running live**, and tell them the estimate from `pnpm eval <suite> --estimate`.
- Always pin `--model-config <file>` and record the prompt versions. Results go to `evals/runs/<timestamp>-<suite>/` (git-ignored) as `results.jsonl` + `summary.json`.
- Compare runs with `pnpm eval compare <runA> <runB>`.

## Metrics (in summary.json)

- `calcAccuracy`: share of numeric answers within tolerance (default rel 0.5%) of ground truth
- `citationPrecision` / `citationRecall`: whether cited spans exist and support the claim
- `rubricScore`: BankerToolBench expert rubric, scored by the benchmark's own grader
- `riskPrecision` / `riskRecall`: detected deal risks vs. annotated risks
- `hallucinationRefusalRate`: on unanswerable or false-premise questions
- `consistency`: share of figures identical across workbook, memo, and dashboard
- `completionRate`, `latencyP50/P95`, `costUsdMean/Total`, `tokensByNode`

When you report results, always show the quality metrics **and** the cost/latency side by side. Use the `eval-analyst` subagent to explain regressions.
