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
  This fixture allows 40 minutes per agent.
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

## Compare project-instruction modes

Use the paired harness when evaluating the compiled project-instruction path
against the legacy AGENTS.md path. It runs only P and snapshots Node, the full
installed `node_modules` tree, every first-party runtime package, and the
`benchmark-agents.js` entrypoint with its complete transitive local-script
import closure and external durable-workflow fixture/quality files. Cells
execute only that copied entrypoint. Relative
workspace links remain internal to the copy; absolute, escaping, dangling, or
nested realpath escapes are rejected before execution. The harness hashes that isolated closure before and after every sample, then
deletes it after the experiment. Both modes therefore execute the same runtime;
any copied runner/helper or runtime mutation hard-stops the run, while edits to
the live checkout cannot alter an active experiment. Every repetition uses fresh fixture and
configuration state.

The selected `models.json` is copied once into a mode-`0600` temporary runtime
snapshot outside the publishable result tree, hashed before and after every
cell, and deleted when the experiment ends. Results retain only that SHA-256
and each sample's verified provider, model, API, and response-model identity.
The requested provider/model must have an exact entry with explicit positive
context-window and output-token metadata in this immutable snapshot; custom-id
fallback inheritance is rejected before the first cell.
If the source file is absent, the harness snapshots that absence and passes an
explicit private nonexistent path to every cell, so a file appearing in the
live location cannot change later cells. Results record whether the source was
present, but credentials or private endpoints from the live file are never copied into the
benchmark evidence directory.

The paired harness separately snapshots `~/.p/agent/auth.json` once into
mode-`0600` private temporary storage, including an explicit absent state. Each
cell receives its own writable copy, so provider refreshes remain cell-local
and cannot mutate the authoritative snapshot. The source-path environment hint
is consumed before the agent starts. Before any cell is retained, the harness
captures initial and refreshed auth values, redacts auth paths, content, secret
leaves, and hashes from plain-text and Brotli artifacts, and scans the copied
result tree again. An artifact that cannot be scanned or safely redacted is
removed and fails the benchmark. Scratch output from a nonzero, signaled, or
otherwise untrusted child completion is discarded rather than retained. Auth
content, source or snapshot paths, and hashes are never written to results; all
authoritative and cell-local copies are deleted on successful and failed runs.
Installed `node_modules` trees are removed before link validation and retention:
they are reproducible fixture machinery rather than evidence, and their
package-manager symlinks must not weaken the rule that every retained link
fails closed.

Run three to five repetitions. Pair order is seed-randomized and
counterbalanced per task; retain the seed from `results.json` to reproduce the
schedule:

```bash
P_BENCHMARK_CANDIDATE_VERSION=5.0.1-rc.1 npm run benchmark:project-instructions -- \
  --model mini-pc/task-model \
  --compiler-model mini-pc/compiler-model \
  --models-file ~/.p/agent/models.json \
  --task event-sourced-inventory \
  --runs 3 \
  --timeout-seconds 2400 \
  --max-runtime-seconds 18000 \
  --output benchmarks/results/<timestamp>-v5.0.1-rc.1-project-instructions-paired
```

Every non-help execution requires `P_BENCHMARK_CANDIDATE_VERSION`, and the
output path must contain its exact `v5.0.1-rc.<n>` identity. The harness binds
each candidate to an immutable SHA-256 covering the copied P runtime, Node
executable, and complete paired-benchmark orchestration and measurement closure in the private local
`.pdev/benchmark-candidate-registry.json` registry. All three repetitions and
reruns of the same runtime reuse that candidate. The first benchmark of a
changed runtime must use a strictly greater candidate; numeric gaps are allowed,
while reuse against a different runtime and rollback fail closed. `results.json` and
`report.md` always record the candidate and runtime identities. Package
manifests stay unchanged until the certified release transaction sets final
version `5.0.1`.

Repeat `--task` to select several fixtures, or omit it to run all four. The
default overall deadline is 54,000 seconds because three complete pairs across
all fixtures can take many hours. The harness invokes each cell through
`benchmark:agents` with `--agents p --runs 1` and an explicit
`--project-instructions compiled|legacy` selection. `--model` is the task model
for both modes. `--compiler-model` is used only by the one cold certification
and compiled startup; it defaults to the task model when omitted.
`--timeout-seconds` is a minimum cell budget: it raises shorter fixture caps
without reducing the longer inventory or workflow limits. Both sides of every
pair receive the same cap.

### Cold certification and steady-state pairs

Before any pair, the harness runs one cold compiler certification for the exact immutable runtime, instruction source, private model snapshot, dedicated compiler model, compiler version, and compiler contract. The model returns only sparse always-on constraint IDs; production code derives and validates exhaustive classifications, triggers, and the complete compiled artifact before binding them to a private hash-verified seed. Reasoning-capable OpenAI-compatible compiler models must declare a live-verified explicit thinking-disable format; the harness refuses ambiguous compatibility rather than spending the bounded response on reasoning. Cold tokens and runtime are reported once. Certification failure stops the experiment before paired comparisons and retains only branded, allowlisted failure kinds, attempt count, aggregate usage, and elapsed time; raw provider output and stderr never enter benchmark evidence. The task-model identity is certified separately and remains identical in every legacy and compiled cell.

Each compiled cell materializes a workspace-path-correct cache from that certified classification through the production preparation and cache APIs. Per-cell evidence binds the seed and complete artifact closure and proves that provider compiler invocations were exactly zero. Legacy cells reject pre-existing project state and use the production legacy formatter and injection path without a classification seed or compiled cache.

Randomized, counterbalanced pairs compare steady-state session tokens and measured agent runtime only. Cold certification and benchmark pre-seeding/materialization are excluded from paired medians and displayed separately. Repeating cold certification to study compiler reliability is a separate experiment and must not be mixed into these medians.

Correctness is a hard gate. A non-passing process status, any failed visible or
hidden quality check, or an incomplete weighted score stops the experiment
immediately. The partial evidence remains on disk, but the report suppresses
token and runtime comparisons. Only a completely green experiment reports
per-mode median session tokens and agent runtime, per-task medians, and median
within-pair compiled-versus-legacy percentage deltas. Negative deltas favor
compiled mode. Persisted evidence has an explicit `running`, `completed`,
`failed`, or `interrupted` lifecycle state. The correctness gate starts false
and becomes true only after every scheduled sample passes; an incomplete or
interrupted run can therefore never retain an optimistic passing sentinel.

SIGINT and SIGTERM propagate cooperatively through the outer harness, active
cell, benchmark runner, and agent turn. Each layer sends SIGTERM, escalates to
SIGKILL after a bounded grace period when necessary, and waits for child close
before finalizing evidence and removing owned private roots. Interruption writes
terminal sanitized evidence, preserves the conventional signal exit code, and
suppresses performance conclusions like every other non-complete run. The
terminal document is published only after global resource finalization and
records `cleanup.status` as `completed` or `failed`; a cleanup failure revokes
an otherwise passing gate without exposing the underlying private diagnostic.

While a cell is active, the harness writes a small uncompressed
`progress/*.jsonl` stream and prints a sanitized heartbeat every 50 seconds.
For paired cells, the monitor tails the private active recording and derives
liveness from deduplicated `tool_execution_start` events—not from Git
dirtiness. Each record contains only elapsed time, a coarse semantic phase,
semantic-event and potentially-mutating-action counts, whether and when the
first potentially mutating tool started, and whether semantic evidence is
available and complete. It never contains prompt text, tool arguments,
credential material, or absolute paths. Inspect this stream at least once per
minute during live runs to catch a cell stalled in discovery or implementation.
The file is closed and compressed independently with Brotli Q6 when the cell
ends, including failure and interruption. With complete semantic evidence,
the requirement-definition attempt count is exact: it counts deduplicated tool
starts whose name is `record_requirement_audit` and whose arguments have
`action: "define"`. If recording evidence is incomplete, the exact count stays
`null`; the separately reported observed count is only a lower bound and the
report renders it as `at least N`.
Definition has its own `requirement_definition` phase and settles back to
planning; it is not a mutation and cannot set the first-mutation timestamp.
Tool-end events settle active semantic phases so progress does not remain stuck
on a completed action. Hard-stop failures are classified as `process`, `status`,
`correctness`, `provider`, or `infrastructure` without changing the correctness
gate or exposing raw provider output.

The benchmark-only startup probe exits the child before task work if compiled
mode produces fallback/exact output, leaks a legacy marker, or otherwise lacks
exactly one well-formed compiled marker. The shared parser accepts attribute
order differences but requires exactly the `agents_sha256`, `input_sha256`, and
`mode` attributes with valid values; missing, duplicate, extra, malformed, or
multiple markers fail closed. Legacy mode similarly fails before task work when
the exact source was not loaded or its independently reproduced legacy rendering
was not injected. Large sources are checked against the same deterministic 6k
legacy compaction contract rather than incorrectly requiring verbatim
injection. Nonzero or signaled agent turns are
terminal failures and are never retried by the watchdog. A failed compiler's
allowlisted, hash-bound diagnostic is evaluated before positive token and
quality metrics, so a zero-token startup failure retains its safe cause instead
of being reported as generic incomplete metrics.

Every launched P turn receives a distinct receipt bound to the cell receipt,
turn ordinal, and the parent-known exact prompt hash and byte length. The probe
consumes and removes the complete reserved environment namespace, returns one
bounded canonical proof through the turn's private IPC channel, waits for the
send callback, and disconnects before agent work. Delivery failure best-effort
disconnects and exits with the preflight code; extension error handling cannot
resume the model. The runner requires exactly one matching proof and one matching
user event for every launched turn, so missing, reordered, or replayed turns fail
immediately.

The inner runner commits the sanitized `results.json` bytes in memory before an
exclusive mode-`0600` publication, then sends the turn authority and exact digest
through a separate outer IPC channel that is not inherited by P or model-tool
descendants. The outer harness rejects missing, duplicate, malformed, or oversized
authority before accessing the result, opens the result without following links,
performs a bounded exact-byte hash check and fatal UTF-8 decode, and reconciles the
proof arrays with the outer message. Child-writable files and exposed receipt
identities therefore cannot authorize their own prompt or result evidence.

The paired result directory contains a top-level `results.json` and `report.md`.
Individual raw recordings, diagnostics, and final workspaces live below
`cells/run-<n>/<task>/<mode>/`. This keeps every sample independently
inspectable while the top-level files preserve the randomized schedule,
runtime hash, correctness decision, and aggregate medians. The harness also
commits each fresh fixture into an isolated local Git baseline with no remote,
hooks, automatic maintenance, or detached GC. This gives completion audits
current executable evidence for protected-file invariants while keeping both
modes on the same starting tree. The harness also
snapshots the root AGENTS.md once under `inputs/`, copies that exact input into
every fixture, runs fixtures in a temporary tree outside the repository so no
parent AGENTS.md leaks into a sample, and records its SHA-256. Compiled samples
must prove exactly one canonical `workspace/AGENTS.md` manifest source whose
recorded and live content hashes match that snapshot, even when inherited
instruction sources are also present. They must also prove matching
certified-classification and cache-closure hashes, zero provider compiler calls,
and matching `.pdev/instructions` pointer, result hash, source, prompt, catalogs,
catalog
pages, and exact rule-module hashes plus a hash-only proof that the compiled
marker reached the effective base system prompt and that no legacy marker
appeared anywhere. Because reader availability removes only exact known
fallback-guidance lines, the seed receipt independently enumerates every
authorized tool-conditioned prompt projection and the child must report that
exact hash set; a child-supplied allowlist cannot authorize another projection.
All persisted benchmark evidence is projected into an exact public schema, and
unknown or malformed nested fields fail closed instead of being copied into
results. Legacy samples prove on
every prompt that the hashed AGENTS source was loaded and that the independently
hashed expected legacy rendering was injected through the legacy base-system
block, including turns with no dynamic route. The harness
captures every user turn, runtime route, successful or failed `read_rules`
batch, and potentially mutating tool call with event ordinals. It recomputes
deterministic selection from the compiled manifest for both user text and
concrete action arguments. User-text matches are candidates only. The first
potentially mutating action reserves its highest-ranked action route first,
then fills remaining slots from the turn candidates and later action routes,
producing one authoritative batch of at most three followed by exactly one
successful matching `read_rules` call before
any mutation completes. Exploratory and split reads do not count; read-only
discovery remains ungated, and later actions reuse the satisfied authoritative
batch without rerouting or staging a second batch. Only hashes, links,
ordinals, and marker metadata are copied into top-level evidence; full
instruction and user text remains in the private scratch tree or compressed
recording. The private classification seed is never copied to results; the
top-level certificate contains only identity hashes and the one-time cold usage
and runtime.

### Recording durability and capture limits

Each agent turn writes exact raw JSONL bytes into a private mode-`0700` chunk
directory. At most 32 MiB remains in its mode-`0600` active file. Rotation
closes and fsyncs that file, Brotli-Q6 compresses it into a private temporary
chunk, decodes the chunk, and verifies its byte length and SHA-256 before an
atomic rename publishes it. Only then is the raw chunk removed and a new active
file opened. The live monitor consumes committed chunks and the active prefix
without gaps or duplicates, including rotations completed between polls.

Finalization recomposes the ordered chunks into the existing single
`.jsonl.br` artifact, verifies the complete decoded length and SHA-256, fsyncs
and atomically publishes it, then writes a private terminal manifest last and
removes chunk scratch. The parent independently validates that manifest and
the archive's actual encoded size, replays the final archive authoritatively,
then consumes the private manifest before credential redaction and retention.
Missing, corrupt, gapped, partial, active-only, or mismatched evidence therefore
cannot pass the correctness gate. Chunk count remains internal bookkeeping; it
is not presented as independently attested evidence after chunk scratch closes.

Capture is fail-closed and bounded. Defaults are 8 GiB for decoded raw
recording bytes, 256 MiB for live/chunk scratch, 256 MiB for the final archive
and its terminal receipt, and 32 MiB for one active raw chunk. The two physical
budgets enforce a 512 MiB peak across crash-safe source and final publication.
Other defaults are 1 MiB for one JSONL line, 16 MiB and 65,536 events for retained per-turn
metric output, 32 MiB for combined metric output, 256 retained runtime
contexts, 4 MiB of stderr per turn, 8 MiB of combined stderr, and 8 MiB for a
raw stdout probe. Separating decoded and physical limits allows highly
compressible cumulative model snapshots to progress without allowing
incompressible output to exhaust disk.
An oversized P `agent_end` line from the explicitly selected canonical P JSON
producer is a special non-semantic case: its cumulative transcript is already
represented by earlier events, so the parser discards that duplicate while the
raw recorder still preserves every byte. A bounded streaming recognizer requires
the exact `type`, `messages`, and `willRetry` envelope and a terminating LF or
CRLF; a prefix match alone is insufficient. The event ordinal advances exactly
once, but the discarded line cannot renew semantic progress or enter retained
metrics. Other agents, an invalid or duplicate `type`, an unterminated line, a
different event type, or any oversized event needed for metrics, routing, or
completion evidence still fails closed. CR in a CRLF delimiter is not counted
against the JSON record's byte limit, including when CR and LF arrive in separate
stream chunks.
Exceeding a byte or collection cap terminates the child and records structured
`capture_overflow` evidence naming the capture, configured byte or entry limit,
minimum observed byte or entry count, and turn when known. It is an
`infrastructure` failure, so correctness and performance conclusions are
suppressed. Raw-recording
or recording-storage overflow retains only the exact accepted prefix, marks it
partial in evidence, and still publishes that prefix through the verified
lifecycle above for diagnosis. If the independently bounded final archive
cannot fit, finalization fails closed and no sample is trusted or retained.

## Results

Each run creates `benchmarks/results/<timestamp>/` containing:

- `report.md` — human-readable summary and per-task comparison.
- `results.json` — machine-readable metrics and verification checks.
- `progress/*.jsonl.br` — sanitized per-cell liveness evidence, written as
  plain JSONL only while the cell is active and compressed with Brotli Q6 after
  it closes.
- `recordings/*.jsonl.br` — individually Brotli Q6-compressed raw JSONL
  session event recordings from each agent.
- `stderr/*.log.br` — independently Brotli Q6-compressed, bounded task and
  startup/provider diagnostics for each invocation.
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

Each closed recording, progress stream, and stderr diagnostic is compressed
independently with Brotli quality 6. Metric extraction retains only terminal
message, tool, retry, and step events in memory, so long cumulative
streaming-delta sessions do not exhaust the Node.js string limit. Persisted
result evidence replaces absolute output, repository, and home paths with
portable placeholders. Kilo startup evidence retains runtime logs and sandbox
policy but excludes volatile lock state, which can contain ephemeral
credentials and host identity.

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
