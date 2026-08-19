# Agent benchmark report

Generated: 2026-08-17T23:19:45.073Z

PI/P model alias: `mini-pc/sokann-qwen-27b-cache`

Versions: `p 0.4.224`

Sequential agent order: `p`

Runs: 1 repetition across 1 fixture; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Nudges | Timed out | Failed | Avg wall time | Avg input tokens | Avg cached tokens | Cache hit % | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| p | 1/1 | 1/1 | 6/6 | 0 | 0 | 0 | 649447 ms | 62,488 | 1,098,262 | 94.6% | 11,248 | 1,171,998 | 48.0 | 4.0 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **p**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Input tokens | Cached tokens | Cache hit % | Output tokens | Total tokens | Tool calls | Nudges | Checks | Weighted score |
| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 1 | p | typescript-calculator | passed | 649447 ms | 62,488 | 1,098,262 | 94.6% | 11,248 | 1,171,998 | 48 | 0 | 6/6 | 6/6 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Cache hit percentage is cached-read tokens divided by input, cached-read, and cache-write prompt tokens.
- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.
- Nudge watchdog monitors agent task completion: if an agent exits before timeout without creating `finish_notes.md`, a reminder is sent to continue. Each nudge incurs a 15-point penalty from the raw weighted score.
- Fixture checks run the TypeScript test suite and typecheck; advanced fixtures score each hidden invariant independently. Inventory emphasizes atomicity and tamper safety; durable workflow adds DAG scheduling, lease fencing, retry timing, compensation, and adversarial recovery.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
