# Durable workflow and saga engine

Implement a production-quality deterministic in-memory workflow orchestrator.

## Public API

Export `WorkflowEngine`, `ValidationError`, `ConcurrencyError`, and all public types from `src/index.ts`.

`WorkflowEngine` must provide:

- `start(definition, { commandId, now })`
- `claim(workerId, now, leaseMs)`
- `heartbeat(claim, now, leaseMs)`
- `complete(claim, output, { commandId, now })`
- `fail(claim, error, { commandId, now })`
- `cancel(workflowId, { commandId, now, reason })`
- `state(workflowId)`
- `history(workflowId)`
- `exportLog()`
- `static fromLog(log)`

A definition has a non-empty `workflowId` and tasks with:

- unique non-empty `id`
- `dependsOn?: string[]`
- `maxAttempts?: number` (default 1, positive integer)
- `retryDelayMs?: number` (default 0, non-negative integer)
- `compensate?: boolean` (default false)

Claims contain `workflowId`, `taskId`, `mode` (`execute` or `compensate`), `attempt`, `workerId`, opaque `leaseToken`, and `leaseExpiresAt`.

`state(workflowId)` returns `{ workflowId, status, version, tasks }`. `tasks` is a record keyed by task ID; each task exposes `status`, `attempt`, and deep-copied `output` when completed. Workflow status is one of `running`, `succeeded`, `failed`, `compensating`, `compensated`, or `cancelled`.

## Required semantics

- Validate the complete DAG before starting. Reject duplicate IDs, missing dependencies, self-dependencies, cycles, invalid retry settings, reused workflow IDs, and non-monotonic time without partial mutation.
- Scheduling is deterministic across workflows: lexicographically smallest workflow ID, then lexicographically smallest runnable task ID. A task becomes runnable only after all dependencies succeed.
- Claims are exclusive leases. Heartbeats extend only the current matching lease. Expired work may be reclaimed with a new token and incremented attempt. Stale, foreign, expired, or already-consumed claims throw `ConcurrencyError`.
- `complete` stores a deep-copied output. `fail` retries after `retryDelayMs * 2 ** (attempt - 1)`. No claim may occur before that virtual time. Exhausting attempts fails the workflow and starts compensation when required.
- `cancel` prevents new forward work. Successfully completed compensatable tasks are then claimed in reverse completion order with `mode: "compensate"`. Compensation uses the same fencing and retry rules. Final status is `compensated` after failure or `cancelled` after cancellation.
- Command IDs are globally idempotent. An exact retry returns a deep copy of the original result and appends nothing. Reusing a command ID with different input throws `ValidationError`.
- Returned claims, states, outputs, results, and history are deep copies.
- Every successful mutation appends events with contiguous global `position`, per-workflow `version`, `previousHash`, and lowercase SHA-256 `hash`. The canonical hash input is `JSON.stringify(eventWithoutHash)` using the event's insertion order.
- `exportLog()` is deterministic newline-terminated JSONL: event lines followed by one manifest containing `eventCount` and `headHash`.
- `fromLog()` validates JSON structure, positions, workflow versions, legal transitions, command identity, hashes, the manifest, truncation, and extra data before restoring. Restore must export byte-identical JSONL and continue positions, versions, leases, retries, and hash links.

Keep orchestration in `src/engine.ts`, scheduling/lease logic in `src/scheduler.ts`, durable log validation in `src/store.ts`, and exports in `src/index.ts`. Additional focused modules are allowed. Add substantial tests beyond the contract. Do not modify supplied files or install dependencies. Run `npm test` and `npm run typecheck`.
