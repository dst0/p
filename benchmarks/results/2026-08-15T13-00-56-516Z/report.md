# Agent benchmark report

Generated: 2026-08-15T16:31:10.648Z

PI/P model alias: `mini-pc/sokann-qwen-27b-cache`

Kilo model alias: `llm-orchestrator/sokann-qwen-27b`

Kilo resolved backend model: `mini-pc/sokann-qwen-27b` (startup probe: passed)

Versions: `pi 0.82.1`, `p 0.4.206`, `kilo 7.4.17`

Sequential agent order: `pi` → `p` → `kilo`

Runs: 1 repetition across 4 fixtures; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Timed out | Failed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pi | 2/4 | 2/4 | 106/270 | 0 | 2 | 783609 ms | 8,702 | 19,330 | 452,844 | 25.0 | 3.3 |
| p | 2/4 | 2/4 | 225/270 | 0 | 2 | 1385289 ms | 50,953 | 26,964 | 1,130,421 | 42.3 | 6.5 |
| kilo | 0/4 | 2/4 | 108/270 | 1 | 3 | 979660 ms | 63,679 | 10,834 | 404,637 | 22.0 | 0.3 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **p**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks | Weighted score |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- | ---: |
| 1 | pi | typescript-calculator | passed | 220488 ms | 53,079 | 15 | 6/6 | 6/6 |
| 1 | pi | monolith-split | passed | 492915 ms | 288,244 | 31 | 6/6 | 6/6 |
| 1 | pi | event-sourced-inventory | failed | 1823428 ms | 1,425,199 | 45 | 28/30 | 91/100 |
| 1 | pi | durable-workflow-saga | failed | 597606 ms | 44,853 | 9 | 1/32 | 3/158 |
| 1 | p | typescript-calculator | passed | 510916 ms | 651,307 | 33 | 6/6 | 6/6 |
| 1 | p | monolith-split | passed | 648306 ms | 543,459 | 33 | 6/6 | 6/6 |
| 1 | p | event-sourced-inventory | failed | 2211567 ms | 1,872,257 | 58 | 27/30 | 88/100 |
| 1 | p | durable-workflow-saga | failed | 2170368 ms | 1,454,660 | 45 | 25/32 | 125/158 |
| 1 | kilo | typescript-calculator | failed | 646330 ms | 352,448 | 25 | 6/6 | 6/6 |
| 1 | kilo | monolith-split | timed_out | 1200022 ms | 612,803 | 34 | 6/6 | 6/6 |
| 1 | kilo | event-sourced-inventory | failed | 1266473 ms | 605,688 | 23 | 28/30 | 93/100 |
| 1 | kilo | durable-workflow-saga | failed | 805814 ms | 47,610 | 6 | 1/32 | 3/158 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.
- Fixture checks run the TypeScript test suite and typecheck; advanced fixtures score each hidden invariant independently. Inventory emphasizes atomicity and tamper safety; durable workflow adds DAG scheduling, lease fencing, retry timing, compensation, and adversarial recovery.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Kilo fixtures start only after bounded model-resolution and request probes pass. Probe recordings, stderr, runtime logs, and state evidence are under [diagnostics/kilo-startup](./diagnostics/kilo-startup).
- Kilo currently emits duplicate JSONL events. Raw recordings preserve them; calculated Kilo metrics deduplicate events by event type, part ID, and state.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
