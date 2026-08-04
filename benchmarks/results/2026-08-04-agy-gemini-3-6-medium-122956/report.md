# Agent benchmark report

Generated: 2026-08-04T12:34:38.929Z

PI/P model alias: `not selected`

AGY model: `gemini-3.6-flash-medium`

Versions: `agy 1.1.10`

Executable: `/Users/dst/.local/bin/agy`

Authentication: confirmed by a bounded successful startup request; evidence is under [diagnostics/startup-probe](./diagnostics/startup-probe).

Requested model label: `Gemini 3.6 Medium`. AGY exposes the exact selectable ID `gemini-3.6-flash-medium`; it does not emit a separate display-name field.

Sequential agent order: `agy`

Runs: 1 repetition across 3 fixtures; lower time/tokens/tool calls are better.

## Summary

| Agent | Completed passes | Quality passes | Weighted score | Timed out | Failed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| agy | 3/3 | 3/3 | 112/112 | 0 | 0 | 90748 ms | 134,401 | 25,856 | 160,257 | 19.7 | 0.3 |

Simple winner by completed pass count, then quality pass count, tokens, and time: **agy**. This is a directional result, not a general model or agent ranking.

## Per-task results

| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks | Weighted score |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- | ---: |
| 1 | agy | typescript-calculator | passed | 60400 ms | 112,916 | 15 | 6/6 | 6/6 |
| 1 | agy | monolith-split | passed | 70939 ms | 141,768 | 19 | 6/6 | 6/6 |
| 1 | agy | event-sourced-inventory | passed | 140906 ms | 226,087 | 25 | 30/30 | 100/100 |

## Interpretation

- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.
- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.
- Fixture checks run the TypeScript test suite and typecheck; the calculator also has a CLI acceptance check, the refactor checks its focused modules and reduced facade, and the inventory challenge scores each fixed hidden invariant independently with higher weights for atomicity and tamper/truncation safety.
- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.
- AGY used `--output-format stream-json`, `--dangerously-skip-permissions`, and bounded `--print-timeout` values of 15, 20, and 40 minutes for calculator, monolith, and inventory respectively.
- Token counts are AGY's reported `total_tokens`; cache-read tokens are retained separately in `results.json`. Tool calls are deduplicated by AGY step index.
- Fixtures and verification are identical to the Pi/P/Kilo/Codex runs, but AGY uses a different backend model. Scores are comparable; latency and token usage are not agent-only comparisons.
- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.

## Five-agent fixture/scoring comparison

| Agent | Backend model | Completed | Quality | Score | Avg wall time | Avg total tokens | Avg tool calls |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Pi `0.83.0` | `mini-pc/sokann-qwen-27b-cache` | 1/3 | 1/3 | 11/112 | 508,300 ms | 20,462 | 6.7 |
| P `0.4.118` | `mini-pc/sokann-qwen-27b-cache` | 2/3 | 2/3 | 105/112 | 1,084,249 ms | 419,743 | 25.3 |
| Kilo `7.4.17` | `mini-pc/sokann-qwen-27b-cache` | 2/3 | 2/3 | 101/112 | 572,662 ms | 510,492 | 28.7 |
| Codex `0.146.0-alpha.9.2` | `gpt-5.6-sol` | 3/3 | 3/3 | 112/112 | 391,724 ms | 1,143,007 | 26.0 |
| AGY `1.1.10` | `gemini-3.6-flash-medium` | 3/3 | 3/3 | 112/112 | 90,748 ms | 160,257 | 19.7 |

AGY and Codex tie on fixture quality at `112/112`; AGY has the lower observed average wall time, token count, and tool-call count in this one-run sample.
