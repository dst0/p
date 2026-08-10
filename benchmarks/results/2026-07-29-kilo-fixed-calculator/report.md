# Agent benchmark report

Generated: 2026-07-29T09:31:14.170Z

PI/P model alias: `not selected`

Kilo model alias: `llm-orchestrator/sokann-qwen-27b`

Versions: `kilo 7.4.16`

Sequential agent order: `kilo`

Runs: 1 repetition across 1 fixture; lower time/tokens/tool calls are better.

## Summary

| Agent | Passed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| kilo | 1/1 | 248587 ms | 19,102 | 5,380 | 243,255 | 18.0 | 0.0 |

Simple winner by pass count, then tokens, then time: **kilo**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- |
| 1 | kilo | typescript-calculator | passed | 248587 ms | 243,255 | 18 | 6/6 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Fixture checks run the TypeScript test suite and typecheck; the calculator also has a CLI acceptance check, the refactor checks its focused modules and reduced facade, and the inventory challenge adds hidden checks for idempotency, atomic rollback, immutability, replay, and hash-chain tamper detection.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Kilo currently emits duplicate JSONL events. Raw recordings preserve them; calculated Kilo metrics deduplicate events by event type, part ID, and state.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
