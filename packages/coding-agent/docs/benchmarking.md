# Agent benchmarking

The repository includes a short comparative benchmark for this fork (`p`) and
the upstream `@mariozechner/pi-coding-agent` package. It runs the same model
against the same three fixtures and records the JSON event stream from both
agents.

## Run it

Build the coding agent first, then run one repetition:

```bash
npm run build --workspace packages/coding-agent
npm run benchmark:agents -- \
  --model mini-pc/model \
  --models-file ~/.p/agent/models.json
```

Replace `mini-pc/model` and the models file with the provider/model configured
on your machine. The model must be available to both agents. API keys and
subscription credentials are inherited from the environment or copied from
`~/.p/agent/auth.json` into temporary agent directories; they are never written
to the result directory.

The default run uses three fixtures, one repetition, a 120-second timeout per
agent task, and a 15-minute overall deadline. Use `--runs 3` for a more stable
sample:

```bash
npm run benchmark:agents -- \
  --model mini-pc/model \
  --models-file ~/.p/agent/models.json \
  --runs 3
```

## Results

Each run creates `benchmarks/results/<timestamp>/` containing:

- `report.md` — human-readable summary and per-task comparison.
- `results.json` — machine-readable metrics and verification checks.
- `recordings/*.jsonl` — raw session event recordings from each agent.
- `stderr/*.log` — startup/provider diagnostics for each invocation.
- `workspaces/` — final fixture files for inspecting the changes made.

The benchmark reports wall time, input/output/total tokens, turns, tool calls,
tool errors, retry/error events, and task quality checks. The quality checks
cover read-only preservation, report creation, and fixing a failing test without
editing its test file.

Run results are intentionally not treated as a universal ranking: one model,
one machine, one upstream version, and a small fixture set cannot establish a
general performance winner. Repeat the run and compare the recordings when a
change is expected to affect tool use, context size, retries, or compaction.
