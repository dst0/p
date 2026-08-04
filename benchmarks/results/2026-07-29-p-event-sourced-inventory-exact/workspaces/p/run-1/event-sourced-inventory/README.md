# Event-sourced inventory engine

Build a production-quality in-memory TypeScript inventory engine. The public API and required behavior are below.

## Public API

Export these from `src/index.ts`:

- `InventoryEngine`
- `ConcurrencyError extends Error`
- `ValidationError extends Error`
- all public command, state, event, result, and option types

`InventoryEngine` must provide:

- `execute(command, { commandId, expectedVersion })`
- `executeBatch(items)`, where each item contains `command`, `commandId`, and `expectedVersion`
- `state(sku)`
- `history(sku)`
- `exportLog()`
- `static fromLog(log)`

Commands are discriminated unions:

- `{ type: "create-sku", sku }`
- `{ type: "receive", sku, quantity }`
- `{ type: "reserve", sku, orderId, quantity }`
- `{ type: "release", sku, orderId, quantity }`
- `{ type: "ship", sku, orderId, quantity }`

State has exactly `sku`, `onHand`, `reserved`, `available`, `reservations`, and `version`. A new SKU starts at version 1. Every successful command emits one event and increments that SKU's version. Events have a global one-based `position`, per-SKU `version`, `commandId`, `type`, `sku`, command-specific data, `previousHash`, and `hash`.

## Required semantics

- Quantities must be positive integers. SKU, order ID, and command ID must be non-empty after trimming.
- A command's `expectedVersion` must equal the current SKU version; creating a SKU expects version 0. Stale commands throw `ConcurrencyError`.
- Receiving increases `onHand`. Reserving cannot exceed `available`. Releasing and shipping cannot exceed that order's reservation. Shipping reduces both `onHand` and the reservation.
- Retrying the exact same command with the same command ID and options returns the original result without appending an event. Reusing a command ID for anything different throws `ValidationError`.
- A batch is atomic across all SKUs: either all commands and idempotency records commit in order, or no observable state changes. Within a batch, each expected version is checked against effects of earlier items.
- Returned state, results, and history must be deep copies; callers cannot mutate engine state.
- `exportLog()` returns deterministic newline-terminated JSONL: one line per event followed by a manifest line with `type: "manifest"`, `eventCount`, and `headHash`. Event hashes are lowercase SHA-256 hashes over a documented canonical representation that includes the preceding hash. The first `previousHash` is `null`.
- `fromLog()` validates structure, positions, stream versions, invariants, every hash link, the manifest, and command-ID consistency before restoring. Any truncation, extra data, malformed JSON, impossible transition, or tampering throws `ValidationError`. A restored engine must export byte-for-byte identical JSONL and continue positions and hash links correctly.

Keep storage/event-log concerns in `src/store.ts`, domain behavior in `src/engine.ts`, and the public facade in `src/index.ts`. You may add focused modules. Add substantial tests beyond the contract test. Do not change the README, project configuration, or contract test. Use only Node built-ins and the existing toolchain; do not install dependencies. Run `npm test` and `npm run typecheck` before finishing.
