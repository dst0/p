# Agent benchmark report

Generated: 2026-07-31T05:23:53.464Z

PI/P model alias: `qwen36-35b-iq2m-mtp`

Kilo model alias: `llm-orchestrator/sokann-qwen-27b`

Versions: `pi 0.82.1`, `p 0.4.117`, `kilo 7.4.16`

Sequential agent order: `pi` → `p` → `kilo`

Runs: 1 repetition across 3 fixtures; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Timed out | Failed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pi | 0/3 | 0/3 | 6/112 | 0 | 3 | 15792 ms | 0 | 0 | 0 | 0.0 | 0.0 |
| p | 0/3 | 0/3 | 6/112 | 0 | 3 | 4781 ms | 0 | 0 | 0 | 0.0 | 0.0 |
| kilo | 1/3 | 1/3 | 91/112 | 2 | 0 | 1175847 ms | 151,660 | 8,476 | 193,574 | 16.0 | 0.0 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **kilo**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks | Weighted score |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- | ---: |
| 1 | pi | typescript-calculator | failed | 16548 ms | 0 | 0 | 1/6 | 1/6 |
| 1 | pi | monolith-split | failed | 15384 ms | 0 | 0 | 3/6 | 3/6 |
| 1 | pi | event-sourced-inventory | failed | 15443 ms | 0 | 0 | 1/30 | 2/100 |
| 1 | p | typescript-calculator | failed | 5037 ms | 0 | 0 | 1/6 | 1/6 |
| 1 | p | monolith-split | failed | 4673 ms | 0 | 0 | 3/6 | 3/6 |
| 1 | p | event-sourced-inventory | failed | 4633 ms | 0 | 0 | 1/30 | 2/100 |
| 1 | kilo | typescript-calculator | passed | 489370 ms | 93,596 | 12 | 6/6 | 6/6 |
| 1 | kilo | monolith-split | timed_out | 1200045 ms | 213,233 | 18 | 4/6 | 4/6 |
| 1 | kilo | event-sourced-inventory | timed_out | 1838127 ms | 273,894 | 18 | 25/30 | 81/100 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.
- Fixture checks run the TypeScript test suite and typecheck; the calculator also has a CLI acceptance check, the refactor checks its focused modules and reduced facade, and the inventory challenge scores each fixed hidden invariant independently with higher weights for atomicity and tamper/truncation safety.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Kilo currently emits duplicate JSONL events. Raw recordings preserve them; calculated Kilo metrics deduplicate events by event type, part ID, and state.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
