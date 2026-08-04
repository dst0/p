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

The benchmark runs each selected agent sequentially against three TypeScript fixtures in isolated temporary workspaces:

### Fixtures

1. **typescript-calculator** — Build an interactive CLI calculator with a syntax parser, AST, and REPL shell. Tests verify CLI acceptance, unit tests, and type checking.

2. **monolith-split** — Refactor a 2,000+ line single-file TypeScript monolith into focused modules. Tests verify module structure, facade size reduction, and type checking.

3. **event-sourced-inventory** — Implement a production-quality event-sourced inventory engine with idempotency, atomic multi-SKU rollback, optimistic concurrency, hash-chained JSONL, and replay validation. Scored by 30 independent hidden invariants.

### Scoring

Each fixture runs automated checks after the agent completes (or times out):

- **Completed pass**: Agent exited cleanly before timeout
- **Quality pass**: Final workspace checks pass regardless of timeout
- **Weighted score**: Points based on checks passed, with higher weights for atomicity and safety invariants

### Recording

Each agent session is recorded as compressed JSONL under `results/<timestamp>/recordings/`. Token counts, tool calls, and wall times are extracted from these recordings.

## Configuration

### Pi / P

Uses `~/.p/agent/models.json` (or `--models-file`). The model alias must resolve to an accessible provider.

### Kilo Code CLI

Uses `~/.config/kilo/kilo.jsonc` (or `--kilo-config`). Set the model via `--kilo-model`.

### Codex CLI

Uses `~/.codex/config.toml` (or `--codex-config`). Set the model via `--codex-model`.

## Output

Results are written to `benchmarks/results/<timestamp>/` containing:

- `report.md` — Human-readable summary table
- `results.json` — Machine-readable results
- `recordings/` — Compressed JSONL session recordings
- `workspaces/` — Final agent workspaces per task

## Requirements

- Node.js 24+
- Pi CLI installed (`npm install -g @anthropic/pi`)
- P CLI built locally (this repository)
- Kilo Code CLI installed (optional)
- Codex CLI installed (optional)
- Target model accessible via configured provider
