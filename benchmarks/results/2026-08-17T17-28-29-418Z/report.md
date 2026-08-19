# Agent benchmark report

Generated: 2026-08-17T19:43:40.735Z

PI/P model alias: `mini-pc/sokann-qwen-27b-cache`

Versions: `p 0.4.224`

Sequential agent order: `p`

Runs: 1 repetition across 4 fixtures; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Nudges | Timed out | Failed | Avg wall time | Avg input tokens | Avg cached tokens | Cache hit % | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| p | 0/4 | 3/4 | 226/270 | 0 | 4 | 0 | 2025039 ms | 212,594 | 2,168,263 | 91.1% | 33,238 | 2,414,094 | 71.0 | 11.3 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **p**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Input tokens | Cached tokens | Cache hit % | Output tokens | Total tokens | Tool calls | Nudges | Checks | Weighted score |
| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 1 | p | typescript-calculator | timed_out | 900014 ms | 197,713 | 1,029,400 | 83.9% | 11,172 | 1,238,285 | 48 | 0 | 6/6 | 6/6 |
| 1 | p | monolith-split | timed_out | 1200015 ms | 136,186 | 1,760,706 | 92.8% | 19,453 | 1,916,345 | 61 | 0 | 6/6 | 6/6 |
| 1 | p | event-sourced-inventory | timed_out | 2400098 ms | 248,270 | 2,500,115 | 91.0% | 41,054 | 2,789,439 | 79 | 0 | 30/30 | 100/100 |
| 1 | p | durable-workflow-saga | timed_out | 3600028 ms | 268,207 | 3,382,829 | 92.7% | 61,272 | 3,712,308 | 96 | 0 | 24/32 | 114/158 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Cache hit percentage is cached-read tokens divided by input, cached-read, and cache-write prompt tokens.
- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.
- Nudge watchdog monitors agent task completion: if an agent exits before timeout without creating `finish_notes.md`, a reminder is sent to continue. Each nudge incurs a 15-point penalty from the raw weighted score.
- Fixture checks run the TypeScript test suite and typecheck; advanced fixtures score each hidden invariant independently. Inventory emphasizes atomicity and tamper safety; durable workflow adds DAG scheduling, lease fencing, retry timing, compensation, and adversarial recovery.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
