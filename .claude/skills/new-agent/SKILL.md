---
name: new-agent
description: Scaffold or modify a DealPilot LangGraph.js agent node (research, modeling, forensic, skeptic, verifier, deliverable, or a new one) in TypeScript with Zod state, structured outputs, versioned prompts, tracing and offline Vitest tests. Use when adding an agent, a tool for an agent, or changing graph wiring.
---

# Agent node scaffold (`packages/agents`)

```
packages/agents/src/<name>/
├── index.ts         # export const <name>Node = async (state: DealState, deps: Deps): Promise<Partial<DealState>>
├── tools.ts         # LangChain tools built with tool(fn, { name, description, schema: z.object(...) })
├── schemas.ts       # Zod output schemas: the ONLY thing this agent writes to state
├── prompts/
│   └── v1.md        # system prompt; add v2.md on change, never edit a version after evals ran
└── <name>.test.ts   # offline tests with recorded LLM fixtures
```

## Rules

- Make every LLM call through `deps.llm` (from `@dealpilot/llm`), passing `node: "<name>"` (it selects the LiteLLM model group for that role). Never import `openai`, `@anthropic-ai/sdk` and the like directly.
- Use structured output only: `deps.llm.structured({ schema: OutputSchema, ... })`. Parse it with Zod, and on a parse error retry once with the error appended to the prompt. After that, emit a `Defect`.
- Tools that return numbers must call `@dealpilot/finance`. Tools that return facts must return `Evidence` objects.
- Emit trace events: `deps.trace.step({ node, inputs, outputs, toolCalls, model, tokens, costUsd, latencyMs })`.
- Respect the budget: check `state.budget.remainingUsd` before an expensive call. Degrade gracefully (cheaper model group, less context) rather than fail.
- The **Verifier** gets a _fresh_ context: the claims, the evidence ids, and the finance package. It never sees the producing agent's prompt or reasoning.

## Wiring (`packages/graph`)

- `state.ts` defines the state with LangGraph `Annotation.Root` or Zod, with reducers for append-only arrays (facts, defects, trace).
- Register the node in `build.ts` (`new StateGraph(...).addNode(...)`). Conditional edges go in `routes.ts`.
- Defect routing works like this: `verifier → routeDefects → <owning agent>` with `maxRetries` per defect type. Once retries run out, set `defect.status = "unresolved"` and carry on to the deliverable.
- The checkpointer is `@langchain/langgraph-checkpoint-postgres`, so jobs can resume after a worker restart.

## Tests (offline, Vitest)

- `FakeLLM` replays `__fixtures__/llm/<name>/*.json`. Assert on the Zod-valid state update and the trace events, not on prose.
- Add one golden end-to-end case to `evals/smoke/` when the agent changes what the deliverable contains.
