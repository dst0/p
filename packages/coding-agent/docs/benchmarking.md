# Agent benchmarking

The repository includes a comparative benchmark for this fork (`p`), the
current `@earendil-works/pi-coding-agent` package, and optionally Kilo Code
CLI. It runs the same underlying model against two longer TypeScript workloads
and records each agent's JSON event stream. The workloads are deliberately
large enough for planning, tool use, implementation, testing, and iteration to
matter:

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
  --models-file ~/.p/agent/models.json \
  --pi-version 0.82.1
```

Replace `mini-pc/model` and the models file with the provider/model configured
on your machine. The model must be available to PI and P. API keys and
subscription credentials are inherited from the environment or copied from
`~/.p/agent/auth.json` into temporary agent directories; they are never written
to the result directory.

To include Kilo, install the pinned Kilo CLI version and pass its model alias
and config file:

```bash
npm run benchmark:agents -- \
  --agents pi,p,kilo \
  --model mini-pc/model \
  --models-file ~/.p/agent/models.json \
  --pi-version 0.82.1 \
  --kilo-model llm-orchestrator/sokann-qwen-27b \
  --kilo-version 7.4.16 \
  --kilo-config ~/.config/kilo/kilo.jsonc \
  --max-runtime-seconds 3600
```

The PI/P and Kilo aliases may differ, but they must resolve to the same
underlying model and runtime configuration. Verify the resolved provider model
before interpreting results. Kilo runs with `--pure --auto` and isolated
temporary XDG config, data, cache, and state directories. Its source config is
copied into that temporary directory and removed when the benchmark exits.

The default run uses PI then P, two fixtures, one repetition, fixture-specific
timeouts, and a 15-minute overall deadline. `--agents` controls the fixed
sequential order. Include a larger deadline for Kilo or repeated runs:

```bash
npm run benchmark:agents -- \
  --model mini-pc/model \
  --models-file ~/.p/agent/models.json \
  --runs 2 \
  --max-runtime-seconds 1800
```

If one workload reaches the overall deadline, rerun just that workload while
keeping the same `--agents` order:

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
tool errors, retry/error events, and task quality checks. Kilo currently emits
each JSONL event twice; raw recordings preserve those events, while calculated
Kilo metrics deduplicate them by event type, part ID, and state. The quality
checks run the fixture's test suite and typecheck; the calculator also has a
CLI acceptance check, while the refactor checks that the monolith became a
small facade, the required focused modules and new tests exist, and the
contract files stayed unchanged.

The raw recordings can be decompressed or streamed directly, for example:

```bash
jq '.results[] | {agent, task, status, elapsedMs, tokens: .metrics.usage.totalTokens, toolCalls: .metrics.toolCalls, errors: .metrics.errors}' \
  benchmarks/results/<timestamp>/results.json

gzip -dc benchmarks/results/<timestamp>/recordings/p-run-1-typescript-calculator.jsonl.gz | head
```

Results are intentionally not treated as a universal ranking: one model, one
machine, one run order, fixed agent versions, and a small fixture set cannot
establish a general performance winner. Repeat the run and compare the
recordings when a change is expected to affect tool use, context size, retries,
or compaction. A committed two-agent example result is available at
[`benchmarks/results/2026-07-19-long-tasks-mini-pc-model/report.md`](../../../benchmarks/results/2026-07-19-long-tasks-mini-pc-model/report.md)
and the focused refactor rerun at
[`benchmarks/results/2026-07-19-monolith-split-mini-pc-model/report.md`](../../../benchmarks/results/2026-07-19-monolith-split-mini-pc-model/report.md)
when the benchmark has been run for that model.
