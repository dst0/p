# Agent benchmark report

Generated: 2026-07-29T08:40:22.203Z

PI/P model alias: `mini-pc/model`

Kilo model alias: `llm-orchestrator/sokann-qwen-27b`

Versions: `pi 0.82.1`, `p 0.4.110`, `kilo 7.4.16`

Sequential agent order: `pi` → `p` → `kilo`

Runs: 1 repetition across 2 fixtures; lower time/tokens/tool calls are better.

## Summary

| Agent | Passed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pi | 1/2 | 347176 ms | 12,089 | 9,479 | 117,298 | 20.5 | 3.0 |
| p | 2/2 | 424307 ms | 20,813 | 9,971 | 415,130 | 33.5 | 8.0 |
| kilo | 0/2 | 450070 ms | 0 | 0 | 0 | 0.0 | 0.0 |

Simple winner by pass count, then tokens, then time: **p**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- |
| 1 | pi | typescript-calculator | timed_out | 300035 ms | 90,328 | 16 | 4/6 |
| 1 | pi | monolith-split | passed | 394318 ms | 144,267 | 25 | 6/6 |
| 1 | p | typescript-calculator | timed_out | 300021 ms | 312,741 | 29 | 6/6 |
| 1 | p | monolith-split | passed | 548593 ms | 517,519 | 38 | 6/6 |
| 1 | kilo | typescript-calculator | timed_out | 300056 ms | 0 | 0 | 1/6 |
| 1 | kilo | monolith-split | timed_out | 600085 ms | 0 | 0 | 3/6 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Fixture checks run the TypeScript test suite and typecheck; the calculator also has a CLI acceptance check, while the refactor checks its focused modules, added tests, reduced facade, and unchanged contract files.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Kilo currently emits duplicate JSONL events. Raw recordings preserve them; calculated Kilo metrics deduplicate events by event type, part ID, and state.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
