# Agent benchmarking

The repository includes a comparative benchmark for this fork (`p`) and the
upstream `@mariozechner/pi-coding-agent` package. It runs the same model
against two longer TypeScript workloads and records the JSON event stream from
both agents. The workloads are deliberately large enough for planning,
tool-use, implementation, testing, and iteration to matter:

- `typescript-calculator` — build a calculator library and CLI from a written
  specification, with unit tests and a contract test.
- `monolith-split` — split a large existing TypeScript module into focused
  parser, query, and report modules while preserving its public API and
  passing the existing contract tests.

## Run it

Build and relink the coding agent first, then run one repetition:

```bash
./reinstall.sh
npm run benchmark:agents -- \
  --model mini-pc/model \
  --models-file ~/.p/agent/models.json
```

Replace `mini-pc/model` and the models file with the provider/model configured
on your machine. The model must be available to both agents. API keys and
subscription credentials are inherited from the environment or copied from
`~/.p/agent/auth.json` into temporary agent directories; they are never written
to the result directory.

The default run uses two fixtures, one repetition, a 300-second timeout per
agent task, and a 15-minute overall deadline. Because each repetition runs
both agents on both long tasks, use a larger deadline when repeating it:

```bash
npm run benchmark:agents -- \
  --model mini-pc/model \
  --models-file ~/.p/agent/models.json \
  --runs 2 \
  --max-runtime-seconds 1800
```

If one workload reaches the overall deadline, rerun just that workload while
keeping the same sequential agent order:

```bash
npm run benchmark:agents -- \
  --model mini-pc/model \
  --models-file ~/.p/agent/models.json \
  --task monolith-split \
  --output benchmarks/results/<timestamp>-monolith-split \
  --max-runtime-seconds 900
```

## Results

Each run creates `benchmarks/results/<timestamp>/` containing:

- `report.md` — human-readable summary and per-task comparison.
- `results.json` — machine-readable metrics and verification checks.
- `recordings/*.jsonl.gz` — gzip-compressed raw JSONL session event recordings from each agent.
- `stderr/*.log` — startup/provider diagnostics for each invocation.
- `workspaces/` — final fixture files for inspecting the changes made.

The benchmark reports wall time, input/output/total tokens, turns, tool calls,
tool errors, retry/error events, and task quality checks. The quality checks
run the fixture's test suite and typecheck; the calculator also has a CLI
acceptance check, while the refactor checks that the monolith became a small
facade, the required focused modules and new tests exist, and the contract
files stayed unchanged.

The raw recordings can be decompressed or streamed directly, for example:

```bash
jq '.results[] | {agent, task, status, elapsedMs, tokens: .metrics.usage.totalTokens, toolCalls: .metrics.toolCalls, errors: .metrics.errors}' \
  benchmarks/results/<timestamp>/results.json

gzip -dc benchmarks/results/<timestamp>/recordings/p-run-1-typescript-calculator.jsonl.gz | head
```

Results are intentionally not treated as a universal ranking: one model, one
machine, one upstream version, and a small fixture set cannot establish a
general performance winner. Repeat the run and compare the recordings when a
change is expected to affect tool use, context size, retries, or compaction. A
committed example result is available at
[`benchmarks/results/2026-07-19-long-tasks-mini-pc-model/report.md`](../../../benchmarks/results/2026-07-19-long-tasks-mini-pc-model/report.md)
and the focused refactor rerun at
[`benchmarks/results/2026-07-19-monolith-split-mini-pc-model/report.md`](../../../benchmarks/results/2026-07-19-monolith-split-mini-pc-model/report.md)
when the benchmark has been run for that model.
