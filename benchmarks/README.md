# Agent Benchmark

Compare coding agents (Pi, P, Kilo Code CLI, Codex CLI) using deterministic TypeScript coding fixtures.

## Quick Start

```bash
# Run Pi and P against a local model
npm run benchmark:agents -- --model qwen36-35b-iq2m-mtp

# Run all agents (Pi, P, Kilo) sequentially
npm run benchmark:agents -- --model qwen36-35b-iq2m-mtp --agents pi,p,kilo --kilo-model llm-orchestrator/sokann-qwen-27b

# Include Codex CLI as well
npm run benchmark:agents -- --model qwen36-35b-iq2m-mtp --agents pi,p,kilo,codex --kilo-model llm-orchestrator/sokann-qwen-27b --codex-model qwen36-q4.25

# Custom timeout (per-task) and overall deadline
npm run benchmark:agents -- --model qwen36-35b-iq2m-mtp --agents kilo --kilo-model llm-orchestrator/sokann-qwen-27b --timeout-seconds 600 --max-runtime-seconds 3600
```

## How It Works

The benchmark runs each selected agent sequentially against four TypeScript fixtures in isolated temporary workspaces:

The harness is an internal, strictly checked TypeScript project:

- `src/run-agents.ts` and `src/run-project-instructions.ts` are thin executable entrypoints.
- `src/agents/` owns agent-turn policy and lifecycle behavior.
- `src/harness/` owns shared execution, recording, security, reporting, and immutable-runtime infrastructure.
- `src/project-instructions/` owns the paired project-instruction protocol.
- `src/workloads/` owns task metadata and verification; `fixtures/` contains only static task inputs.
- `test/` mirrors those runtime boundaries, while `results/` remains append-only benchmark evidence and is never part of a runtime snapshot.

### Fixtures

1. **typescript-calculator** — Build an interactive CLI calculator with a syntax parser, AST, and REPL shell. Tests verify CLI acceptance, unit tests, and type checking.

2. **monolith-split** — Refactor a 2,000+ line single-file TypeScript monolith into focused modules. Tests verify module structure, facade size reduction, and type checking.

3. **event-sourced-inventory** — Implement a production-quality event-sourced inventory engine with idempotency, atomic multi-SKU rollback, optimistic concurrency, hash-chained JSONL, and replay validation. Scored by 30 independent hidden invariants.

4. **durable-workflow-saga** — Implement a deterministic workflow and saga engine with DAG scheduling, fenced leases, retries, compensation, and tamper-evident recovery.

### Scoring

Each fixture runs automated checks after the agent completes (or times out):

- **Completed pass**: Agent exited cleanly before timeout
- **Quality pass**: Final workspace checks pass regardless of timeout
- **Weighted score**: Points based on checks passed, with higher weights for atomicity and safety invariants

### Recording

Each agent session is recorded as compressed JSONL under
`results/<timestamp>/recordings/`. A turn writes to a new private mode-`0600`
`.jsonl.active` file while live, then closes and fsyncs it, compresses to a
private temporary file with Brotli Q6, verifies the decoded byte length and
SHA-256 against the raw source, fsyncs, and atomically publishes `.jsonl.br`.
Token counts, tool calls, and wall times are extracted from these recordings.

Paired project-instruction runs also emit a sanitized heartbeat every 50
seconds under `progress/`. Paired liveness comes from deduplicated semantic
`tool_execution_start` events in the active recording, not Git dirtiness. The
live progress file contains elapsed time, coarse semantic phase, semantic and
potentially-mutating-action counts, first mutation-tool timing, and evidence
availability/completeness; it is Brotli-Q6 compressed after the cell closes.
The requirement-definition count includes exactly the starts of
`record_requirement_audit` with `action: "define"`. Review progress at least
once per minute during long cells.

Captures are explicitly bounded: by default, raw recordings are limited to
512 MiB, lines to 1 MiB, per-turn metric output to 16 MiB and 65,536 events,
combined metric output to 32 MiB, runtime contexts to 256, per-turn/combined
stderr to 4/8 MiB, and raw stdout probes to 8 MiB. Overflow terminates the
child and produces structured `capture_overflow` infrastructure evidence, so
no correctness or performance conclusion is reported. A raw-recording
overflow retains and marks only its bounded partial prefix, then publishes it
through the same verified compression lifecycle for diagnosis.

## Configuration

### Pi / P

Uses `~/.p/agent/models.json` (or `--models-file`). The paired project-instruction benchmark snapshots it once into private ephemeral storage, verifies its hash for every cell, records only presence, the hash, and resolved model identity, and deletes the snapshot. An absent source is preserved as one explicit private nonexistent path, so a live file appearing later cannot change the run. It also snapshots present or absent `~/.p/agent/auth.json`; each cell receives a private writable copy while auth content, paths, and hashes stay out of results, and every copy is deleted on exit. The paired harness snapshots and hashes both TypeScript entrypoints, their complete local import closure, and the exact benchmark fixtures; every cell executes only that copied runtime. Tests and historical results are excluded from the snapshot. The model alias must resolve to an accessible provider.

Before retaining a cell, the paired harness redacts initial or refreshed auth
paths, values, and hashes from plain-text and Brotli recordings, diagnostics,
results, and final workspaces, then scans the copied tree again. Unsafe or
unreadable artifacts are removed and fail the run rather than being published.
Reproducible `node_modules` installs are omitted from retained workspaces before
link validation; all other retained symlinks and hard links still fail closed.

### Kilo Code CLI

Uses `~/.config/kilo/kilo.jsonc` (or `--kilo-config`). Set the model via `--kilo-model`.

### Codex CLI

Uses `~/.codex/config.toml` (or `--codex-config`). Set the model via `--codex-model`.

## Output

Results are written to `benchmarks/results/<timestamp>/` containing:

- `report.md` — Human-readable summary table
- `results.json` — Machine-readable results
- `progress/` — Sanitized paired-cell liveness evidence
- `recordings/` — Compressed JSONL session recordings
- `stderr/` — Independently Brotli-Q6-compressed bounded task/startup
  diagnostics (`*.log.br`)
- `workspaces/` — Final agent workspaces per task

Retained workspaces intentionally exclude `node_modules`; install from the
fixture lockfile when reproducing a quality check.

## Requirements

- Node.js 22.19+
- Pi CLI installed (`npm install -g @anthropic/pi`)
- P CLI built locally (this repository)
- Kilo Code CLI installed (optional)
- Codex CLI installed (optional)
- Target model accessible via configured provider
