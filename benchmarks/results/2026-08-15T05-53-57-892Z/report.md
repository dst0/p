# Agent benchmark report

Generated: 2026-08-15T07:24:38.203Z

PI/P model alias: `mini-pc/sokann-qwen-27b-cache`

Kilo model alias: `llm-orchestrator/sokann-qwen-27b`

AGY model: `gemini-3.6-flash-medium`

Kilo resolved backend model: `mini-pc/sokann-qwen-27b` (startup probe: passed)

AGY resolved model: `gemini-3.6-flash-medium` (startup probe: passed)

Versions: `pi 0.82.1`, `p 0.4.206`, `kilo 7.4.17`, `agy 1.1.13`

Sequential agent order: `pi` → `p` → `kilo` → `agy`

Runs: 1 repetition across 4 fixtures; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Timed out | Failed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pi | 0/4 | 0/4 | 9/270 | 0 | 4 | 15245 ms | 0 | 0 | 0 | 0.0 | 0.0 |
| p | 0/4 | 0/4 | 9/270 | 0 | 4 | 4499 ms | 0 | 0 | 0 | 0.0 | 0.0 |
| kilo | 0/4 | 0/4 | 103/270 | 0 | 4 | 1280340 ms | 88,685 | 12,058 | 443,241 | 22.0 | 0.3 |
| agy | 0/4 | 0/4 | 9/270 | 0 | 4 | 10858 ms | 0 | 0 | 0 | 0.0 | 0.0 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **kilo**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks | Weighted score |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- | ---: |
| 1 | pi | typescript-calculator | failed | 16446 ms | 0 | 0 | 1/6 | 1/6 |
| 1 | pi | monolith-split | failed | 14792 ms | 0 | 0 | 3/6 | 3/6 |
| 1 | pi | event-sourced-inventory | failed | 14828 ms | 0 | 0 | 1/30 | 2/100 |
| 1 | pi | durable-workflow-saga | failed | 14913 ms | 0 | 0 | 1/32 | 3/158 |
| 1 | p | typescript-calculator | failed | 5447 ms | 0 | 0 | 1/6 | 1/6 |
| 1 | p | monolith-split | failed | 4166 ms | 0 | 0 | 3/6 | 3/6 |
| 1 | p | event-sourced-inventory | failed | 4180 ms | 0 | 0 | 1/30 | 2/100 |
| 1 | p | durable-workflow-saga | failed | 4204 ms | 0 | 0 | 1/32 | 3/158 |
| 1 | kilo | typescript-calculator | failed | 207808 ms | 17,713 | 4 | 1/6 | 1/6 |
| 1 | kilo | monolith-split | failed | 1070603 ms | 655,250 | 38 | 4/6 | 4/6 |
| 1 | kilo | event-sourced-inventory | failed | 2083158 ms | 867,025 | 36 | 29/30 | 95/100 |
| 1 | kilo | durable-workflow-saga | failed | 1759791 ms | 232,974 | 10 | 1/32 | 3/158 |
| 1 | agy | typescript-calculator | failed | 12350 ms | 0 | 0 | 1/6 | 1/6 |
| 1 | agy | monolith-split | failed | 10824 ms | 0 | 0 | 3/6 | 3/6 |
| 1 | agy | event-sourced-inventory | failed | 10046 ms | 0 | 0 | 1/30 | 2/100 |
| 1 | agy | durable-workflow-saga | failed | 10210 ms | 0 | 0 | 1/32 | 3/158 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.
- Fixture checks run the TypeScript test suite and typecheck; advanced fixtures score each hidden invariant independently. Inventory emphasizes atomicity and tamper safety; durable workflow adds DAG scheduling, lease fencing, retry timing, compensation, and adversarial recovery.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Kilo fixtures start only after bounded model-resolution and request probes pass. Probe recordings, stderr, runtime logs, and state evidence are under [diagnostics/kilo-startup](./diagnostics/kilo-startup).
- Kilo currently emits duplicate JSONL events. Raw recordings preserve them; calculated Kilo metrics deduplicate events by event type, part ID, and state.
- AGY fixtures start only after a bounded request probe confirms the exact requested model. Probe recording, stderr, and state evidence are under [diagnostics/agy-startup](./diagnostics/agy-startup).
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
