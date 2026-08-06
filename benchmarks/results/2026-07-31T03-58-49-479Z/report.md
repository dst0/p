# Agent benchmark report

Generated: 2026-07-31T04:13:52.210Z

PI/P model alias: `mini-pc/sokann-qwen-27b`

Kilo model alias: `llm-orchestrator/sokann-qwen-27b`

Versions: `pi 0.82.1`, `p 0.4.117`, `kilo 7.4.16`

Sequential agent order: `pi` → `p` → `kilo`

Runs: 1 repetition across 3 fixtures; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Timed out | Failed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pi | 0/1 | 0/1 | 2/6 | 1 | 0 | 900059 ms | 5,644 | 5,688 | 69,736 | 15.0 | 2.0 |
| p | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 ms | 0 | 0 | 0 | 0.0 | 0.0 |
| kilo | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 ms | 0 | 0 | 0 | 0.0 | 0.0 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **pi**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks | Weighted score |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- | ---: |
| 1 | pi | typescript-calculator | timed_out | 900059 ms | 69,736 | 15 | 2/6 | 2/6 |
| 1 | pi | monolith-split | skipped | — | — | — | skipped | — |
| 1 | pi | event-sourced-inventory | skipped | — | — | — | skipped | — |
| 1 | p | typescript-calculator | skipped | — | — | — | skipped | — |
| 1 | p | monolith-split | skipped | — | — | — | skipped | — |
| 1 | p | event-sourced-inventory | skipped | — | — | — | skipped | — |
| 1 | kilo | typescript-calculator | skipped | — | — | — | skipped | — |
| 1 | kilo | monolith-split | skipped | — | — | — | skipped | — |
| 1 | kilo | event-sourced-inventory | skipped | — | — | — | skipped | — |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.
- Fixture checks run the TypeScript test suite and typecheck; the calculator also has a CLI acceptance check, the refactor checks its focused modules and reduced facade, and the inventory challenge scores each fixed hidden invariant independently with higher weights for atomicity and tamper/truncation safety.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Kilo currently emits duplicate JSONL events. Raw recordings preserve them; calculated Kilo metrics deduplicate events by event type, part ID, and state.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
