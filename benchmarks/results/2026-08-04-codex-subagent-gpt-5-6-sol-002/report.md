# Agent benchmark report

Generated: 2026-08-04T12:21:53.845Z

PI/P model alias: `not selected`

Codex model: `gpt-5.6-sol`

Codex provider: `default` (no `model_provider` override)

Model comparability: fixtures and scoring are identical, but Codex uses a different backend model from PI/P/Kilo.

Versions: `codex codex-cli 0.146.0-alpha.9.2`

Sequential agent order: `codex`

Runs: 1 repetition across 3 fixtures; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Timed out | Failed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| codex | 3/3 | 3/3 | 112/112 | 0 | 0 | 391724 ms | 1,128,412 | 14,595 | 1,143,007 | 26.0 | 2.3 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **codex**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks | Weighted score |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- | ---: |
| 1 | codex | typescript-calculator | passed | 198971 ms | 560,605 | 18 | 6/6 | 6/6 |
| 1 | codex | monolith-split | passed | 335473 ms | 1,199,358 | 29 | 6/6 | 6/6 |
| 1 | codex | event-sourced-inventory | passed | 640728 ms | 1,669,058 | 31 | 30/30 | 100/100 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.
- Fixture checks run the TypeScript test suite and typecheck; the calculator also has a CLI acceptance check, the refactor checks its focused modules and reduced facade, and the inventory challenge scores each fixed hidden invariant independently with higher weights for atomicity and tamper/truncation safety.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- Codex used `gpt-5.6-sol` through the default Codex provider. It is comparable to PI/P/Kilo in fixtures and scoring, but not in backend-model terms.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.

## Four-agent fixture/scoring comparison

| Agent | Backend model | Completed | Quality | Score | Avg wall time | Avg total tokens | Avg tool calls |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Pi `0.83.0` | `mini-pc/sokann-qwen-27b-cache` | 1/3 | 1/3 | 11/112 | 508,300 ms | 20,462 | 6.7 |
| P `0.4.118` | `mini-pc/sokann-qwen-27b-cache` | 2/3 | 2/3 | 105/112 | 1,084,249 ms | 419,743 | 25.3 |
| Kilo `7.4.17` | `mini-pc/sokann-qwen-27b-cache` | 2/3 | 2/3 | 101/112 | 572,662 ms | 510,492 | 28.7 |
| Codex `0.146.0-alpha.9.2` | `gpt-5.6-sol` (default provider) | 3/3 | 3/3 | 112/112 | 391,724 ms | 1,143,007 | 26.0 |

Codex used identical fixtures and scoring, but its result is not backend-model-comparable with Pi/P/Kilo.
