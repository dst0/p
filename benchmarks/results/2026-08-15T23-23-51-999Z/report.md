# Agent benchmark report

Generated: 2026-08-16T01:23:55.246Z

PI/P model alias: `mini-pc/sokann-qwen-27b-cache`

Kilo model alias: `llm-orchestrator/sokann-qwen-27b`

Kilo resolved backend model: `mini-pc/sokann-qwen-27b` (startup probe: passed)

Versions: `pi 0.82.1`, `kilo 7.4.17`

Sequential agent order: `pi` → `kilo`

Runs: 1 repetition across 1 fixture; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Nudges | Timed out | Failed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pi | 0/1 | 0/1 | 77/158 | 2 | 1 | 0 | 3600045 ms | 381,824 | 69,444 | 1,035,177 | 40.0 | 5.0 |
| kilo | 0/1 | 0/1 | 11/158 | 1 | 1 | 0 | 3534918 ms | 163,111 | 17,879 | 465,726 | 25.0 | 0.0 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **pi**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Nudges | Checks | Weighted score |
| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: |
| 1 | pi | durable-workflow-saga | timed_out | 3600045 ms | 1,035,177 | 40 | 2 | 24/32 | 77/158 (-30) |
| 1 | kilo | durable-workflow-saga | timed_out | 3534918 ms | 465,726 | 25 | 1 | 6/32 | 11/158 (-15) |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.
- Nudge watchdog monitors agent task completion: if an agent exits before timeout without creating `finish_notes.md`, a reminder is sent to continue. Each nudge incurs a 15-point penalty from the raw weighted score.
- Fixture checks run the TypeScript test suite and typecheck; advanced fixtures score each hidden invariant independently. Inventory emphasizes atomicity and tamper safety; durable workflow adds DAG scheduling, lease fencing, retry timing, compensation, and adversarial recovery.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Kilo fixtures start only after bounded model-resolution and request probes pass. Probe recordings, stderr, runtime logs, and state evidence are under [diagnostics/kilo-startup](./diagnostics/kilo-startup).
- Kilo currently emits duplicate JSONL events. Raw recordings preserve them; calculated Kilo metrics deduplicate events by event type, part ID, and state.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
