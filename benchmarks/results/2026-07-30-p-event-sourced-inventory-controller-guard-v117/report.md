# Agent benchmark report

Generated: 2026-07-30T09:32:15.154Z

PI/P model alias: `mini-pc/sokann-qwen-27b`

Versions: `p 0.4.117`

Sequential agent order: `p`

Runs: 1 repetition across 3 fixtures; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Timed out | Failed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| p | 1/3 | 2/3 | 14/112 | 2 | 0 | 299305 ms | 25,664 | 6,361 | 337,218 | 21.7 | 3.0 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **p**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks | Weighted score |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- | ---: |
| 1 | p | typescript-calculator | passed | 221885 ms | 173,769 | 21 | 6/6 | 6/6 |
| 1 | p | monolith-split | timed_out | 600016 ms | 818,830 | 40 | 6/6 | 6/6 |
| 1 | p | event-sourced-inventory | timed_out | 76013 ms | 19,054 | 4 | 1/30 | 2/100 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.
- Fixture checks run the TypeScript test suite and typecheck; the calculator also has a CLI acceptance check, the refactor checks its focused modules and reduced facade, and the inventory challenge scores each fixed hidden invariant independently with higher weights for atomicity and tamper/truncation safety.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
