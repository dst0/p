# Agent benchmark report

Generated: 2026-08-16T22:44:10.300Z

PI/P model alias: `mini-pc/sokann-qwen-27b-cache`

Kilo model alias: `llm-orchestrator/sokann-qwen-27b`

Kilo resolved backend model: `mini-pc/sokann-qwen-27b` (startup probe: passed)

Versions: `p 0.4.223`, `pi 0.82.1`, `kilo 7.4.17`, `codex codex-cli 0.146.0-alpha.9.2`

Sequential agent order: `p` → `pi` → `kilo` → `codex`

Runs: 1 repetition across 1 fixture; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Nudges | Timed out | Failed | Avg wall time | Avg input tokens | Avg cached tokens | Cache hit % | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| p | 1/1 | 1/1 | 85/100 | 1 | 0 | 0 | 2087924 ms | 48,217 | 1,346,312 | 96.5% | 44,492 | 1,439,021 | 51.0 | 12.0 |
| pi | 0/1 | 0/1 | 63/100 | 2 | 0 | 1 | 2378004 ms | 12,703 | 573,043 | 97.8% | 65,955 | 651,701 | 30.0 | 4.0 |
| kilo | 0/1 | 0/1 | 2/100 | 0 | 1 | 0 | 2400111 ms | 0 | 0 | 0.0% | 0 | 0 | 0.0 | 0.0 |
| codex | 0/1 | 0/1 | 0/100 | 5 | 0 | 1 | 76289 ms | 0 | 0 | 0.0% | 0 | 0 | 0.0 | 0.0 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **p**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Input tokens | Cached tokens | Cache hit % | Output tokens | Total tokens | Tool calls | Nudges | Checks | Weighted score |
| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 1 | p | event-sourced-inventory | passed | 2087924 ms | 48,217 | 1,346,312 | 96.5% | 44,492 | 1,439,021 | 51 | 1 | 30/30 | 85/100 (-15) |
| 1 | pi | event-sourced-inventory | failed | 2378004 ms | 12,703 | 573,043 | 97.8% | 65,955 | 651,701 | 30 | 2 | 28/30 | 63/100 (-30) |
| 1 | kilo | event-sourced-inventory | timed_out | 2400111 ms | 0 | 0 | 0.0% | 0 | 0 | 0 | 0 | 1/30 | 2/100 |
| 1 | codex | event-sourced-inventory | failed | 76289 ms | 0 | 0 | 0.0% | 0 | 0 | 0 | 5 | 1/30 | 0/100 (-75) |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Cache hit percentage is cached-read tokens divided by input, cached-read, and cache-write prompt tokens.
- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.
- Nudge watchdog monitors agent task completion: if an agent exits before timeout without creating `finish_notes.md`, a reminder is sent to continue. Each nudge incurs a 15-point penalty from the raw weighted score.
- Fixture checks run the TypeScript test suite and typecheck; advanced fixtures score each hidden invariant independently. Inventory emphasizes atomicity and tamper safety; durable workflow adds DAG scheduling, lease fencing, retry timing, compensation, and adversarial recovery.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Kilo fixtures start only after bounded model-resolution and request probes pass. Probe recordings, stderr, runtime logs, and state evidence are under [diagnostics/kilo-startup](./diagnostics/kilo-startup).
- Kilo currently emits duplicate JSONL events. Raw recordings preserve them; calculated Kilo metrics deduplicate events by event type, part ID, and state.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
