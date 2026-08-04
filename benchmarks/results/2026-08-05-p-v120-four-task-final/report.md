# Agent benchmark report

Generated: 2026-08-04T15:19:22.382Z

PI/P model alias: `mini-pc/model`

Versions: `p 0.4.120`

Sequential agent order: `p`

Runs: 1 repetition across 4 fixtures; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Timed out | Failed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| p | 2/4 | 2/4 | 214/264 | 0 | 2 | 1058323 ms | 31,708 | 22,039 | 880,186 | 34.3 | 4.3 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **p**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks | Weighted score |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- | ---: |
| 1 | p | typescript-calculator | passed | 281081 ms | 277,174 | 23 | 6/6 | 6/6 |
| 1 | p | monolith-split | passed | 719209 ms | 846,511 | 46 | 6/6 | 6/6 |
| 1 | p | event-sourced-inventory | failed | 1157558 ms | 1,031,145 | 33 | 29/30 | 95/100 |
| 1 | p | durable-workflow-saga | failed | 2075446 ms | 1,365,913 | 35 | 24/31 | 107/152 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.
- Fixture checks run the TypeScript test suite and typecheck; advanced fixtures score each hidden invariant independently. Inventory emphasizes atomicity and tamper safety; durable workflow adds DAG scheduling, lease fencing, retry timing, compensation, and adversarial recovery.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
