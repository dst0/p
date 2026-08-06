# Agent benchmark report

Generated: 2026-07-31T01:43:56.879Z

PI/P model alias: `mini-pc/sokann-qwen-27b-cache`

Versions: `pi 0.82.1`, `p 0.4.112`

Sequential agent order: `pi` → `p`

Runs: 1 repetition across 1 fixture; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Timed out | Failed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pi | 0/1 | 0/1 | 2/100 | 0 | 1 | 544834 ms | 4,360 | 3,103 | 39,054 | 10.0 | 3.0 |
| p | 0/1 | 0/1 | 2/100 | 1 | 0 | 353624 ms | 0 | 0 | 0 | 0.0 | 0.0 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **p**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks | Weighted score |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- | ---: |
| 1 | pi | event-sourced-inventory | failed | 544834 ms | 39,054 | 10 | 1/30 | 2/100 |
| 1 | p | event-sourced-inventory | timed_out | 353624 ms | 0 | 0 | 1/30 | 2/100 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.
- Fixture checks run the TypeScript test suite and typecheck; the calculator also has a CLI acceptance check, the refactor checks its focused modules and reduced facade, and the inventory challenge scores each fixed hidden invariant independently with higher weights for atomicity and tamper/truncation safety.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
