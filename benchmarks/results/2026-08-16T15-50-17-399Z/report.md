# Agent benchmark report

Generated: 2026-08-16T16:18:35.419Z

PI/P model alias: `mini-pc/sokann-qwen-27b-cache`

Versions: `p 0.4.213`

Sequential agent order: `p`

Runs: 1 repetition across 1 fixture; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Nudges | Timed out | Failed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| p | 0/1 | 0/1 | 61/100 | 2 | 0 | 1 | 1696536 ms | 61,829 | 33,776 | 1,650,665 | 57.0 | 11.0 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **p**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Nudges | Checks | Weighted score |
| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: |
| 1 | p | event-sourced-inventory | failed | 1696536 ms | 1,650,665 | 57 | 2 | 28/30 | 61/100 (-30) |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.
- Nudge watchdog monitors agent task completion: if an agent exits before timeout without creating `finish_notes.md`, a reminder is sent to continue. Each nudge incurs a 15-point penalty from the raw weighted score.
- Fixture checks run the TypeScript test suite and typecheck; advanced fixtures score each hidden invariant independently. Inventory emphasizes atomicity and tamper safety; durable workflow adds DAG scheduling, lease fencing, retry timing, compensation, and adversarial recovery.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
