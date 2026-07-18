# Agent benchmark report

Generated: 2026-07-18T19:56:57.877Z

Model: `mini-pc/model`

Upstream: `@mariozechner/pi-coding-agent@0.73.1`

Runs: 1 repetition across 2 fixtures; lower time/tokens/tool calls are better.

## Summary

| Agent | Passed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| p | 1/2 | 173557 ms | 14,792 | 4,003 | 100,601 | 16.0 | 2.5 |
| original | 1/2 | 275009 ms | 8,625 | 6,272 | 73,633 | 18.5 | 2.0 |

Simple winner by pass count, then tokens, then time: **original**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- |
| 1 | p | typescript-calculator | passed | 183087 ms | 133,706 | 17 | 6/6 |
| 1 | original | typescript-calculator | passed | 249983 ms | 83,989 | 17 | 6/6 |
| 1 | original | monolith-split | timed_out | 300035 ms | 63,276 | 20 | 5/6 |
| 1 | p | monolith-split | timed_out | 164027 ms | 67,495 | 15 | 3/6 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Fixture checks run the TypeScript test suite and typecheck; the calculator also has a CLI acceptance check, while the refactor checks its focused modules, added tests, reduced facade, and unchanged contract files.
- The run uses one model, one repetition by default, fresh fixture workspaces, and sequential execution. Repeat with `--runs 2 --max-runtime-seconds 1800` before treating small differences as meaningful.
- Provider latency, model sampling, cache state, and upstream version can dominate this small sample.
