# Agent benchmark report

Generated: 2026-08-01T05:43:11.774Z

PI/P model alias: `mini-pc/sokann-qwen-27b-cache`

Kilo model alias: `mini-pc/sokann-qwen-27b-cache`

Versions: `pi 0.82.1`, `p 0.4.117`, `kilo 7.4.16`

Sequential agent order: `pi` → `p` → `kilo`

Runs: 1 repetition across 3 fixtures; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Timed out | Failed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pi | 0/3 | 0/3 | 6/112 | 3 | 0 | 1500047 ms | 1,802 | 422 | 5,443 | 4.7 | 0.7 |
| p | 1/3 | 1/3 | 104/112 | 0 | 2 | 640757 ms | 24,361 | 9,272 | 353,412 | 18.0 | 2.3 |
| kilo | 0/3 | 0/3 | 6/112 | 0 | 3 | 4034 ms | 0 | 0 | 0 | 0.0 | 0.0 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **p**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks | Weighted score |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- | ---: |
| 1 | pi | typescript-calculator | timed_out | 900056 ms | 4,370 | 4 | 1/6 | 1/6 |
| 1 | pi | monolith-split | timed_out | 1200036 ms | 9,974 | 7 | 3/6 | 3/6 |
| 1 | pi | event-sourced-inventory | timed_out | 2400047 ms | 1,986 | 3 | 1/30 | 2/100 |
| 1 | p | typescript-calculator | passed | 343495 ms | 527,847 | 31 | 6/6 | 6/6 |
| 1 | p | monolith-split | failed | 25271 ms | 0 | 0 | 3/6 | 3/6 |
| 1 | p | event-sourced-inventory | failed | 1553504 ms | 532,389 | 23 | 29/30 | 95/100 |
| 1 | kilo | typescript-calculator | failed | 4423 ms | 0 | 0 | 1/6 | 1/6 |
| 1 | kilo | monolith-split | failed | 3795 ms | 0 | 0 | 3/6 | 3/6 |
| 1 | kilo | event-sourced-inventory | failed | 3884 ms | 0 | 0 | 1/30 | 2/100 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.
- Fixture checks run the TypeScript test suite and typecheck; the calculator also has a CLI acceptance check, the refactor checks its focused modules and reduced facade, and the inventory challenge scores each fixed hidden invariant independently with higher weights for atomicity and tamper/truncation safety.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Kilo currently emits duplicate JSONL events. Raw recordings preserve them; calculated Kilo metrics deduplicate events by event type, part ID, and state.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
