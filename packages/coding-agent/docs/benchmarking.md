# Agent benchmarking

The repository includes a comparative benchmark for this fork (`p`), the
current `@earendil-works/pi-coding-agent` package, and optional Kilo Code,
Codex, and AGY CLIs. It runs the same underlying model against four TypeScript workloads
and records each agent's JSON event stream. The workloads are deliberately
large enough for planning, tool use, implementation, testing, and iteration to
matter:

- `typescript-calculator` — build a calculator library and CLI from a written
  specification, with unit tests and a contract test.
- `monolith-split` — split a large existing TypeScript module into focused
  parser, query, and report modules while preserving its public API and
  passing the existing contract tests.
- `event-sourced-inventory` — build a transactional event-sourced inventory
  engine with optimistic concurrency, idempotent commands, atomic batches,
  hash-chained JSONL replay, tamper detection, and hidden acceptance checks.
  This fixture allows 30 minutes per agent.
- `durable-workflow-saga` — build a deterministic workflow and saga engine
  with DAG scheduling, fenced leases, retries, compensation, and
  tamper-evident recovery. This fixture allows 60 minutes per agent.

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
  --kilo-version 7.4.17 \
  --kilo-config ~/.config/kilo/kilo.jsonc \
  --max-runtime-seconds 3600
```

The PI/P and Kilo aliases may differ, but they must resolve to the same
underlying model and runtime configuration. Verify the resolved provider model
before interpreting results. Kilo runs with `--pure --auto` and isolated
temporary XDG config, data, cache, and state directories. Its source config is
copied into that temporary directory and removed when the benchmark exits.

The default run uses PI then P, four fixtures, one repetition, fixture-specific
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
- `recordings/*.jsonl.br` — individually Brotli Q6-compressed raw JSONL
  session event recordings from each agent.
- `stderr/*.log` — startup/provider diagnostics for each invocation.
- `workspaces/` — final fixture files for inspecting the changes made.

The benchmark reports wall time, input/output/total tokens, cached-read tokens,
cache hit percentage, turns, tool calls, tool errors, retry/error events, and
task quality checks. Cache hit percentage is cached-read tokens divided by the
sum of input, cached-read, and cache-write prompt tokens. Kilo currently emits
each JSONL event twice; raw recordings preserve those events, while calculated
Kilo metrics deduplicate them by event type, part ID, and state. The quality
checks run the fixture's test suite and typecheck; the calculator also has a
CLI acceptance check, while the refactor checks that the monolith became a
small facade, the required focused modules and new tests exist, and the
contract files stayed unchanged. The inventory fixture additionally runs
hidden checks for exact idempotency, multi-SKU rollback, deep-copy reads,
contiguous event positions, replay continuation, and hash-chain tamper
detection. Reports distinguish a clean completion before timeout from a
passing final workspace.

Each recording and closed diagnostic archive is compressed independently with
Brotli quality 6. Metric extraction retains only terminal message, tool, retry,
and step events in memory, so long cumulative streaming-delta sessions do not
exhaust the Node.js string limit. Persisted result evidence replaces absolute
output, repository, and home paths with portable placeholders. Kilo startup
evidence retains runtime logs and sandbox policy but excludes volatile lock
state, which can contain ephemeral credentials and host identity.

The raw recordings can be decompressed or streamed directly, for example:

```bash
jq '.results[] | {agent, task, status, elapsedMs, tokens: .metrics.usage.totalTokens, toolCalls: .metrics.toolCalls, errors: .metrics.errors}' \
  benchmarks/results/<timestamp>/results.json

brotli --decompress --stdout benchmarks/results/<timestamp>/recordings/p-run-1-typescript-calculator.jsonl.br | head
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
