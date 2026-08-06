# Agent benchmark report

Generated: 2026-08-04T14:05:40.447Z

PI/P model alias: `not selected`

AGY model: `gemini-3.6-flash-medium`

AGY resolved model: `gemini-3.6-flash-medium` (startup probe: passed)

Versions: `agy 1.1.10`

Sequential agent order: `agy`

Runs: 1 repetition across 1 fixture; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Timed out | Failed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| agy | 0/1 | 0/1 | 106/152 | 0 | 1 | 161556 ms | 188,446 | 63,540 | 251,986 | 26.0 | 0.0 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **agy**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks | Weighted score |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- | ---: |
| 1 | agy | durable-workflow-saga | failed | 161556 ms | 251,986 | 26 | 21/31 | 106/152 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.
- Fixture checks run the TypeScript test suite and typecheck; advanced fixtures score each hidden invariant independently. Inventory emphasizes atomicity and tamper safety; durable workflow adds DAG scheduling, lease fencing, retry timing, compensation, and adversarial recovery.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- AGY fixtures start only after a bounded request probe confirms the exact requested model. Probe recording, stderr, and state evidence are under [diagnostics/agy-startup](./diagnostics/agy-startup).
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
