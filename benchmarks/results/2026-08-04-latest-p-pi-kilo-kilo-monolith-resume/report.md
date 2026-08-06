# Agent benchmark report

Generated: 2026-08-04T11:03:58.702Z

PI/P model alias: `mini-pc/model`

Kilo model alias: `llm-orchestrator/sokann-qwen-27b-cache`

Kilo resolved backend model: `mini-pc/sokann-qwen-27b-cache` (startup probe: passed)

Versions: `kilo 7.4.17`

Sequential agent order: `kilo`

Runs: 1 repetition across 1 fixture; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Timed out | Failed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| kilo | 1/1 | 1/1 | 6/6 | 0 | 0 | 560742 ms | 25,406 | 11,771 | 538,339 | 32.0 | 0.0 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **kilo**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks | Weighted score |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- | ---: |
| 1 | kilo | monolith-split | passed | 560742 ms | 538,339 | 32 | 6/6 | 6/6 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.
- Fixture checks run the TypeScript test suite and typecheck; the calculator also has a CLI acceptance check, the refactor checks its focused modules and reduced facade, and the inventory challenge scores each fixed hidden invariant independently with higher weights for atomicity and tamper/truncation safety.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Kilo fixtures start only after bounded model-resolution and request probes pass. Probe recordings, stderr, runtime logs, and state evidence are under [diagnostics/kilo-startup](./diagnostics/kilo-startup).
- Kilo currently emits duplicate JSONL events. Raw recordings preserve them; calculated Kilo metrics deduplicate events by event type, part ID, and state.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.
