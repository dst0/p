# Agent benchmark report

Generated: 2026-07-29T10:12:24.511Z

PI/P model alias: `mini-pc/sokann-qwen-27b`

Versions: `pi 0.82.1`

Sequential agent order: `pi`

Runs: 1 repetition across 1 fixture; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Timed out | Failed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pi | 0/1 | 0/1 | 0 | 1 | 608519 ms | 2,669 | 16,813 | 28,805 | 5.0 | 0.0 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **pi**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- |
| 1 | pi | event-sourced-inventory | failed | 608519 ms | 28,805 | 5 | 1/6 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.
- Fixture checks run the TypeScript test suite and typecheck; the calculator also has a CLI acceptance check, the refactor checks its focused modules and reduced facade, and the inventory challenge adds hidden checks for idempotency, atomic rollback, immutability, replay, and hash-chain tamper detection.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
