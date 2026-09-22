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

# Custom nominal task budget/inactivity watchdog and overall deadline
npm run benchmark:agents -- --model qwen36-35b-iq2m-mtp --agents kilo --kilo-model llm-orchestrator/sokann-qwen-27b --timeout-seconds 600 --max-runtime-seconds 3600
```

## How It Works

The benchmark runs each selected agent sequentially against four TypeScript fixtures in isolated temporary workspaces:

The harness is an internal, strictly checked TypeScript project:

- `src/run-agents.ts` and `src/run-project-instructions.ts` are thin executable entrypoints.
- `src/agents/` owns agent-turn policy and lifecycle behavior.
- `src/harness/` owns shared execution, recording, security, reporting, and immutable-runtime infrastructure.
- `src/project-instructions/` owns the paired project-instruction protocol and optional semantic-audit canary.
- `src/workloads/` owns task metadata and verification; `fixtures/` contains only static task inputs.
- `test/` mirrors those runtime boundaries, while `results/` remains append-only benchmark evidence and is never part of a runtime snapshot.

### Fixtures

1. **typescript-calculator** — Build an interactive CLI calculator with a syntax parser, AST, and REPL shell. Tests verify CLI acceptance, unit tests, and type checking.

2. **monolith-split** — Refactor a 2,000+ line single-file TypeScript monolith into focused modules. Tests verify module structure, facade size reduction, and type checking.

3. **event-sourced-inventory** — Implement a production-quality event-sourced inventory engine with idempotency, atomic multi-SKU rollback, optimistic concurrency, hash-chained JSONL, and replay validation. Scored by 30 independent hidden invariants.

4. **durable-workflow-saga** — Implement a deterministic workflow and saga engine with DAG scheduling, fenced leases, retries, compensation, and tamper-evident recovery.

### Scoring

Each fixture runs automated checks after the agent completes (or times out):

- **Completed pass**: Agent exited cleanly after satisfying the terminal protocol
- **Quality pass**: Final workspace checks pass regardless of timeout
- **Weighted score**: Points based on checks passed, with higher weights for atomicity and safety invariants

The per-task timeout is a nominal budget and semantic-inactivity watchdog, not
an unconditional wall-clock kill. Before the nominal budget expires, supported
agent events can extend the active turn with a rolling lease of at most five
minutes. Arbitrary stdout does not renew the lease. A silent or non-semantic
child still times out, and `--max-runtime-seconds` remains the absolute
run-wide safety deadline even while progress continues. If an over-budget turn
exits without accepted terminal completion, the harness does not start another
nudge turn. A process-tree cleanup failure is fatal: the harness releases
stdio, IPC, and child-handle references and does not inspect or verify a
workspace that a surviving agent could still mutate.

### Recording

Each agent session is recorded as compressed JSONL under
`results/<timestamp>/recordings/`. A turn writes to a new private mode-`0600`
`.jsonl.active` file while live, then closes and fsyncs it, compresses to a
private temporary file with Brotli Q6, verifies the decoded byte length and
SHA-256 against the raw source, fsyncs, and atomically publishes `.jsonl.br`.
Token counts, tool calls, and wall times are extracted from these recordings.

Project-instruction runs also emit a sanitized heartbeat every 50 seconds
under `progress/`. Liveness comes from deduplicated semantic
`tool_execution_start` events in the active recording, not Git dirtiness. The
live progress file contains elapsed time, coarse semantic phase, semantic and
potentially-mutating-action counts, first mutation-tool timing, and evidence
availability/completeness; it is Brotli-Q6 compressed after the cell closes.
The requirement-definition count includes exactly the starts of
`record_requirement_audit` with `action: "define"`; sparse repairs are counted
separately. Settled definition/repair events add sanitized draft sizes, repair
arity, diagnostic totals and class histograms, per-cell keyed HMAC-SHA-256 diagnostic
fingerprints, and comparable resolved/persisting/introduced counts. Settled
status events distinguish active rejected-batch recovery from a full-definition
restart. Source text, diagnostic text, repair payloads, and revision values are
never stored in progress evidence. Review progress at least once per minute
during long cells, and do not treat a single increase in raw diagnostic
instances as degradation: atomic splits can expose more specific obligations.

Captures are explicitly bounded: by default, raw recordings are limited to
512 MiB, lines to 1 MiB, metric events to 65,536, runtime contexts to 256,
per-turn/combined stderr to 4/8 MiB, and raw stdout probes to 8 MiB. P task
metrics are reduced incrementally across turns without retaining cumulative
metric JSON text; derived P evidence is separately capped at 16 MiB and 8,192
entries per retained collection. Other agents and bounded probes retain at most
16 MiB per turn and 32 MiB combined. Overflow terminates the child and produces structured
`capture_overflow` infrastructure evidence, so no correctness or performance
conclusion is reported. A raw-recording overflow retains and marks only its
bounded partial prefix, then publishes it through the same verified compression
lifecycle for diagnosis.

## Configuration

### Pi / P

Uses `~/.p/agent/models.json` (or `--models-file`). The project-instruction benchmark snapshots it once into private ephemeral storage, verifies its hash for every cell, records only presence, the hash, and resolved model identity, and deletes the snapshot. An absent source is preserved as one explicit private nonexistent path, so a live file appearing later cannot change the run. It also snapshots present or absent `~/.p/agent/auth.json`; each cell receives a private writable copy while auth content, paths, and hashes stay out of results, and every copy is deleted on exit. The harness snapshots and hashes both TypeScript entrypoints, their complete local import closure, and the exact benchmark fixtures; every cell executes only that copied runtime. Tests and historical results are excluded from the snapshot. The model alias must resolve to an accessible provider.

Every `(repetition, task)` release-gate block runs the same immutable candidate
binary in two conditions: `legacy` uses legacy project instructions with
evidence verification, while `compiled-evidence` uses compiled instructions
with the same evidence verification. This isolates instruction delivery while
free-form requests use one model-generated completion checklist instead of an
exhaustive clause-to-requirement matrix. Pass `--include-audit` to add
`compiled-audit` as an explicit experimental canary for the semantic audit; it
is not part of the default free-text release comparison. Condition order is
seeded, randomized, and position-balanced across three to five repetitions.
Each cell records the requested and effective verification mode; a missing or
collapsed effective mode invalidates the cell. The first incorrect sample
stops the run. Performance medians are suppressed unless every repetition of
all four canonical tasks passes in every selected condition.

Before retaining a cell, the harness redacts initial or refreshed auth
paths, values, and hashes from plain-text and Brotli recordings, diagnostics,
results, and final workspaces, then scans the copied tree again. Unsafe or
unreadable artifacts are removed and fail the run rather than being published.
Reproducible `node_modules` installs are omitted from retained workspaces before
link validation; all other retained symlinks and hard links still fail closed.

### Kilo Code CLI

Uses `~/.config/kilo/kilo.jsonc` (or `--kilo-config`). Set the model via `--kilo-model`.

### Codex CLI

Uses `~/.codex/config.toml` (or `--codex-config`). Set the model via `--codex-model`.

## Certified Comparison Mode

Run an authoritative comparison across `p`, `pi`, and `kilo`:

```bash
npm run benchmark:agents -- --certified --model <model> --expected-resolved-model <resolved-model> --runs 3 \
  --pi-executable <path-to-pi> --kilo-executable <path-to-kilo> \
  --certified-network-host <llm-host:port>
```

Certified mode enforces strict comparative rigor:
- **Agents & Tasks:** Exactly `p`, `pi`, and `kilo` across all 4 canonical benchmark tasks for at least 3 runs.
- **Model Identity, Request, and Resource Parity:** Explicit `--model` and `--expected-resolved-model` required. P and Pi receive byte-identical private `models.json` snapshots and explicit Unlimited run-budget profiles. Surface aliases (such as distinct `--kilo-model` prefixes) are permitted only when runtime evidence confirms identity against `--expected-resolved-model`. The shared Pi/P projection and selected Kilo configuration are privately snapshotted and bound; endpoint identity, request API, context/output limits, reasoning, tool support, modalities, and generation options must match. The bound resource policy records Unlimited internal budgets for P/Pi, harness-only limits for Kilo, and identical per-cell and overall deadlines. Raw configuration and endpoints are never published. Asymmetric generation options and a separate instruction-compiler model are rejected. P is explicitly bound to its default `evidence` task-verification profile so harness completion semantics match the runtime.
- **Containment & Sandbox Isolation:** Candidate execution runs against a candidate runtime snapshot isolated from the live repository and hidden evaluator fixtures (`hidden.test.ts`, `rubric.json`). Pi and Kilo package runtimes plus P's project-instruction probe are copied into and hashed with that immutable snapshot before any startup or task turn. macOS `sandbox-exec` contains startup probes, parity preflights, and all task cells.
- **Executable Closure Provenance:** Package links are inspected before copying. External symbolic links fail before destination creation unless the caller explicitly allowlists the exact package-relative link and resolved regular-file target; accepted external bytes are copied as regular files and their SHA-256 provenance is returned with the snapshot.
- **Instruction Parity & Ephemeral Secret Lifecycle:** All candidate agents (Pi, P, Kilo) are subject to verified runtime instruction parity. Independently generated high-entropy directives are placed at the beginning, middle, and end of the authoritative instructions. Before task cells, an isolated startup preflight accepts only an exact three-part response with zero user-visible file or tool reads, proving automatic loading without a tail-only truncation loophole. Unit tests enforce the fail-closed command and evidence contract; only a live certified preflight against the real P, Pi, and Kilo CLIs supplies final auto-loading proof. Cleanup removes and scans augmented sources, workspace copies, recordings, and published artifacts so no raw receipt survives.
- **Post-Binding Holdouts:** Every canonical task receives fresh randomized, domain-specific checks only after the candidate runtime hash is bound. The private plan and expected results stay evaluator-side; prompts, candidate workspaces, recordings, reports, and public results contain neither the seed nor the complete challenge. Calculator expressions and report transformations vary their data; inventory additionally exercises atomic multi-SKU rollback and command-ID reuse, while workflow exercises lease expiry/reclaim, stale fencing, and retry backoff. Semantic mutants that implement only the earlier happy paths fail. This proves performance on these generated challenge families, not universal agent intelligence; an adaptive or colluding model endpoint remains outside what a local harness can disprove.
- **Bounded Network Egress:** Certified runs require one or more explicit `--certified-network-host <host:port>` values (or comma-separated `P_BENCHMARK_CERTIFIED_NETWORK_HOSTS`). The deny-default macOS sandbox grants outbound TCP only on the declared endpoint ports. Current macOS `sandbox-exec` rejects remote-host predicates other than `*` or `localhost`, so the host names are auditable declarations but cannot be enforced by this host mechanism; any destination on an allowed port remains reachable. This containment is macOS-only and does not prevent an authorized or colluding endpoint from receiving prompt data. Strong host-level egress proof requires a separately verified network namespace, firewall, or proxy outside this harness.
- **Cost Policy & Opt-In Gating:** Monetary cost is accumulated across every streamed provider step (`usage.cost.total`, including Kilo numeric and object forms); malformed, negative, or non-finite values invalidate certification. Tokens are never substituted for cost. Gating on `--max-cost-ratio` is opt-in when cost metrics are available; if cost telemetry is absent, cost gating is skipped while duration and token thresholds remain strictly enforced.
- **Baseline Quality & Protocol Separation:** Process/protocol completion (`exitCode === 0`, no timeouts or unhandled errors) is evaluated independently of the hidden rubric quality score for baseline comparison agents (Pi and Kilo), preserving valid comparative evidence even on partial benchmark completion. P strictly requires 100% rubric pass and zero penalties across every cell, and its mean normalized quality must be strictly higher than each baseline on every canonical task.
- **Counterbalanced Execution:** Deterministic Latin-square scheduling counterbalances agent execution order across task and run cells.
- **Certification Gates:** Publishes success only if all cells complete with verified model evidence, P achieves maximum rubric score with zero penalties across every cell, P strictly exceeds Pi and Kilo quality on each task, and configured duration, token, and cost ratio thresholds pass against both baselines. Multi-cell certified runs bypass single-cell outer authority.

For release evidence, add `--release-target <x.y.z>`. Release certification
requires exactly 3 runs and refreshes `origin/main` before starting, then fails
unless the worktree is clean and `HEAD` exactly matches that revision. After all
36 cells, the harness rechecks the frozen runtime, evaluator, holdout, model
configuration, executables, and instructions; safely removes private state; and
only then persists a Brotli-Q6 receipt in the Git common directory. The release
transaction independently revalidates the result/report matrix and binds that
receipt into its committed release certificate. For a major release it also
copies the sanitized `results.json` and `report.md` into deterministic Brotli-Q6
files under `release-certificates/`; tag verification decompresses and
revalidates those committed artifacts against the bound hashes and matrix rules.
The audit and every active release transition reject benchmark evidence older
than 24 hours or more than five minutes in the future; verification of an
already published tag remains deterministic and does not depend on wall-clock
freshness.

The certified overall deadline defaults to a derived lower bound covering every
selected task timeout across all 36 minimum cells, one startup preflight per
agent, Kilo startup probing, fixed setup allowance, and bounded per-cell
orchestration margin. An explicit `--max-runtime-seconds` below that bound is
rejected instead of starting a run that cannot complete by design.
Every certified result row and nested metric is validated at runtime; missing
models, malformed status or quality fields, non-positive token totals, and
invalid elapsed or cost values fail closed.

## Output

Results are written to `benchmarks/results/<timestamp>/` containing:

- `report.md` — Human-readable summary table
- `results.json` — Machine-readable results
- `progress/` — Sanitized per-condition cell liveness evidence
- `recordings/` — Compressed JSONL session recordings
- `stderr/` — Independently Brotli-Q6-compressed bounded task/startup
  diagnostics (`*.log.br`)
- `workspaces/` — Final agent workspaces per task

Retained workspaces intentionally exclude `node_modules`; install from the
fixture lockfile when reproducing a quality check.
Certified runs default to a private `p-certified-benchmark-*` temporary directory
outside the live repository; the exact location is printed at startup. An
explicit certified output must be absent or an empty, non-symlink mode-`0700`
directory. Task cells are created exclusively, and private results are published
without overwrite. The evaluator snapshot, sealed holdout plan, and private model
configuration snapshots are removed after the final integrity recheck; only
their aggregate hashes remain in release evidence. Retained workspaces also omit `.git`, `AGENTS.md`, and
symlinks after evaluation so ephemeral parity material and external references
cannot survive publication. If process-tree termination is not confirmed, the
harness does not traverse candidate-writable workspace, preflight, or
configuration trees; it still redacts parent-owned receipt artifacts, disposes
independent immutable state, and reports the primary and all cleanup failures
together.
The certified output root and each canonical ancestor are identity-bound by
device, inode, and owner UID, then rechecked before artifact mutations and
publication. Existing symlink, foreign-owner, and hard-linked targets fail
closed. Node does not expose a portable `openat`-style directory-descriptor API,
so a same-user attacker racing in the interval between a check and its filesystem
operation is an explicit residual host limitation; run certification on a host
where no untrusted same-UID process can mutate the output ancestry.

## Requirements

- Node.js 22.19+
- Pi CLI installed (`npm install -g @earendil-works/pi-coding-agent`)
- P CLI built locally (this repository)
- Kilo Code CLI installed (required for `--certified`, optional otherwise)
- Codex CLI installed (optional)
- Target model accessible via configured provider
