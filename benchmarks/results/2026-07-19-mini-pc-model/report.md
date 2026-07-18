# Agent benchmark report

Generated: 2026-07-18T19:22:47.027Z

Model: `mini-pc/model`

Upstream: `@mariozechner/pi-coding-agent@0.73.1`

Runs: 1 repetition across 3 fixtures; lower time/tokens/tool calls are better.

## Summary

| Agent | Passed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| p | 3/3 | 39139 ms | 8,576 | 791 | 39,463 | 7.0 | 1.3 |
| original | 3/3 | 16049 ms | 1,753 | 341 | 5,884 | 3.0 | 0.0 |

Simple winner by pass count, then tokens, then time: **original**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- |
| 1 | p | read-only | passed | 33575 ms | 31,940 | 7 | 2/2 |
| 1 | original | read-only | passed | 12924 ms | 3,637 | 2 | 2/2 |
| 1 | original | report | passed | 12399 ms | 5,444 | 2 | 2/2 |
| 1 | p | report | passed | 38046 ms | 38,084 | 6 | 2/2 |
| 1 | p | debug | passed | 45797 ms | 48,364 | 8 | 3/3 |
| 1 | original | debug | passed | 22823 ms | 8,571 | 5 | 3/3 |

## Interpretation

- Session recordings are the JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Fixture checks measure observable task quality: read-only preservation, report creation, and a passing regression test with the test file untouched.
- The run uses one model, one repetition by default, fresh fixture workspaces, and sequential execution. Repeat with `--runs 3` before treating small differences as meaningful.
- Provider latency, model sampling, cache state, and upstream version can dominate this small sample.
