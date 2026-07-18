# Agent benchmark report

Generated: 2026-07-18T20:10:20.974Z

Model: `mini-pc/model`

Upstream: `@mariozechner/pi-coding-agent@0.73.1`

Runs: 1 repetition across 1 fixtures; lower time/tokens/tool calls are better.

## Summary

| Agent | Passed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| p | 0/1 | 300010 ms | 16,186 | 7,228 | 176,909 | 18.0 | 1.0 |
| original | 0/1 | 300027 ms | 5,372 | 7,425 | 38,613 | 13.0 | 0.0 |

Simple winner by pass count, then tokens, then time: **original**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- |
| 1 | p | monolith-split | timed_out | 300010 ms | 176,909 | 18 | 5/6 |
| 1 | original | monolith-split | timed_out | 300027 ms | 38,613 | 13 | 5/6 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Fixture checks run the TypeScript test suite and typecheck; the calculator also has a CLI acceptance check, while the refactor checks its focused modules, added tests, reduced facade, and unchanged contract files.
- The run uses one model, one repetition by default, fresh fixture workspaces, and sequential execution. Repeat with `--runs 2 --max-runtime-seconds 1800` before treating small differences as meaningful.
- Provider latency, model sampling, cache state, and upstream version can dominate this small sample.
