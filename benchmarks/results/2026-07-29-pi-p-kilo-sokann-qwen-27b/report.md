# Agent benchmark report

Generated: 2026-07-28T20:47:12.281Z

PI/P model alias: `mini-pc/model`

Kilo model alias: `llm-orchestrator/sokann-qwen-27b`

Versions: `pi 0.82.1`, `p 0.4.108`, `kilo 7.4.16`

Sequential agent order: `pi` → `p` → `kilo`

Runs: 1 repetition across 2 fixtures; lower time/tokens/tool calls are better.

## Summary

| Agent | Passed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pi | 2/2 | 362600 ms | 9,210 | 9,849 | 252,556 | 22.5 | 2.0 |
| p | 2/2 | 351254 ms | 27,031 | 8,504 | 433,327 | 28.0 | 7.0 |
| kilo | 0/2 | 450046 ms | 0 | 0 | 0 | 0.0 | 0.0 |

Simple winner by pass count, then tokens, then time: **pi**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- |
| 1 | pi | typescript-calculator | passed | 193053 ms | 69,358 | 13 | 6/6 |
| 1 | pi | monolith-split | passed | 532147 ms | 435,753 | 32 | 6/6 |
| 1 | p | typescript-calculator | passed | 205895 ms | 168,184 | 16 | 6/6 |
| 1 | p | monolith-split | passed | 496613 ms | 698,470 | 40 | 6/6 |
| 1 | kilo | typescript-calculator | timed_out | 300051 ms | 0 | 0 | 1/6 |
| 1 | kilo | monolith-split | timed_out | 600042 ms | 0 | 0 | 3/6 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Fixture checks run the TypeScript test suite and typecheck; the calculator also has a CLI acceptance check, while the refactor checks its focused modules, added tests, reduced facade, and unchanged contract files.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Kilo currently emits duplicate JSONL events. Raw recordings preserve them; calculated Kilo metrics deduplicate events by event type, part ID, and state.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
