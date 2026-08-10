# Agent benchmark report

Generated: 2026-08-01T03:54:26.616Z

PI/P model alias: `mini-pc/sokann-qwen-27b-cache`

Kilo model alias: `mini-pc/sokann-qwen-27b-cache`

Versions: `pi 0.82.1`, `p 0.4.117`, `kilo 7.4.16`

Sequential agent order: `pi` → `p` → `kilo`

Runs: 1 repetition across 3 fixtures; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Timed out | Failed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pi | 0/3 | 0/3 | 6/112 | 1 | 2 | 701013 ms | 2,811 | 6,464 | 17,209 | 5.7 | 1.0 |
| p | 0/2 | 0/2 | 4/12 | 2 | 0 | 745770 ms | 3,648 | 159 | 9,485 | 0.5 | 0.0 |
| kilo | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 ms | 0 | 0 | 0 | 0.0 | 0.0 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **p**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks | Weighted score |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- | ---: |
| 1 | pi | typescript-calculator | timed_out | 900069 ms | 1,951 | 3 | 1/6 | 1/6 |
| 1 | pi | monolith-split | failed | 295115 ms | 13,544 | 7 | 3/6 | 3/6 |
| 1 | pi | event-sourced-inventory | failed | 907854 ms | 36,133 | 7 | 1/30 | 2/100 |
| 1 | p | typescript-calculator | timed_out | 900021 ms | 0 | 0 | 1/6 | 1/6 |
| 1 | p | monolith-split | timed_out | 591519 ms | 18,970 | 1 | 3/6 | 3/6 |
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
