import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  ConcurrencyError,
  InventoryEngine,
  ValidationError,
} from "../src/index.js";

// ============================================================
// Idempotency tests
// ============================================================

test("idempotent retry of the same command returns cached result", () => {
  const engine = new InventoryEngine();
  const r1 = engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  const r2 = engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  assert.deepEqual(r1, r2);
  assert.equal(r1.position, 1);
  assert.equal(r2.position, 1);
  // State should not have changed
  assert.deepEqual(engine.state("A"), {
    sku: "A", onHand: 0, reserved: 0, available: 0, reservations: {}, version: 1,
  });
});

test("reusing commandId with different command throws ValidationError", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  assert.throws(
    () => engine.execute({ type: "receive", sku: "A", quantity: 5 }, { commandId: "c1", expectedVersion: 1 }),
    ValidationError,
  );
});

test("idempotent retry after receive", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "W" }, { commandId: "c1", expectedVersion: 0 });
  const r1 = engine.execute({ type: "receive", sku: "W", quantity: 10 }, { commandId: "r1", expectedVersion: 1 });
  const r2 = engine.execute({ type: "receive", sku: "W", quantity: 10 }, { commandId: "r1", expectedVersion: 1 });
  assert.deepEqual(r1, r2);
  assert.deepEqual(engine.state("W"), {
    sku: "W", onHand: 10, reserved: 0, available: 10, reservations: {}, version: 2,
  });
});

// ============================================================
// Concurrency tests
// ============================================================

test("stale expectedVersion throws ConcurrencyError", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "X" }, { commandId: "c1", expectedVersion: 0 });
  engine.execute({ type: "receive", sku: "X", quantity: 5 }, { commandId: "c2", expectedVersion: 1 });
  // Old version
  assert.throws(
    () => engine.execute({ type: "receive", sku: "X", quantity: 3 }, { commandId: "c3", expectedVersion: 1 }),
    ConcurrencyError,
  );
});

test("wrong expectedVersion on create throws ConcurrencyError", () => {
  const engine = new InventoryEngine();
  assert.throws(
    () => engine.execute({ type: "create-sku", sku: "Y" }, { commandId: "c1", expectedVersion: 5 }),
    ConcurrencyError,
  );
});

// ============================================================
// Validation tests
// ============================================================

test("empty SKU throws ValidationError", () => {
  const engine = new InventoryEngine();
  assert.throws(
    () => engine.execute({ type: "create-sku", sku: "  " }, { commandId: "c1", expectedVersion: 0 }),
    ValidationError,
  );
});

test("empty commandId throws ValidationError", () => {
  const engine = new InventoryEngine();
  assert.throws(
    () => engine.execute({ type: "create-sku", sku: "Z" }, { commandId: "  ", expectedVersion: 0 }),
    ValidationError,
  );
});

test("non-positive quantity throws ValidationError", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "Z" }, { commandId: "c1", expectedVersion: 0 });
  assert.throws(
    () => engine.execute({ type: "receive", sku: "Z", quantity: 0 }, { commandId: "c2", expectedVersion: 1 }),
    ValidationError,
  );
  assert.throws(
    () => engine.execute({ type: "receive", sku: "Z", quantity: -5 }, { commandId: "c3", expectedVersion: 1 }),
    ValidationError,
  );
});

test("non-integer quantity throws ValidationError", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "Z" }, { commandId: "c1", expectedVersion: 0 });
  assert.throws(
    () => engine.execute({ type: "receive", sku: "Z", quantity: 2.5 }, { commandId: "c4", expectedVersion: 1 }),
    ValidationError,
  );
});

test("empty orderId throws ValidationError", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "Z" }, { commandId: "c1", expectedVersion: 0 });
  engine.execute({ type: "receive", sku: "Z", quantity: 10 }, { commandId: "c2", expectedVersion: 1 });
  assert.throws(
    () => engine.execute({ type: "reserve", sku: "Z", orderId: "", quantity: 1 }, { commandId: "c3", expectedVersion: 2 }),
    ValidationError,
  );
});

test("duplicate SKU create throws ValidationError", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  assert.throws(
    () => engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c2", expectedVersion: 1 }),
    ValidationError,
  );
});

test("reserve exceeds available throws ValidationError", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  engine.execute({ type: "receive", sku: "A", quantity: 5 }, { commandId: "c2", expectedVersion: 1 });
  assert.throws(
    () => engine.execute({ type: "reserve", sku: "A", orderId: "o1", quantity: 6 }, { commandId: "c3", expectedVersion: 2 }),
    ValidationError,
  );
});

test("release exceeds reservation throws ValidationError", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  engine.execute({ type: "receive", sku: "A", quantity: 10 }, { commandId: "c2", expectedVersion: 1 });
  engine.execute({ type: "reserve", sku: "A", orderId: "o1", quantity: 3 }, { commandId: "c3", expectedVersion: 2 });
  assert.throws(
    () => engine.execute({ type: "release", sku: "A", orderId: "o1", quantity: 5 }, { commandId: "c4", expectedVersion: 3 }),
    ValidationError,
  );
});

test("ship exceeds reservation throws ValidationError", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  engine.execute({ type: "receive", sku: "A", quantity: 10 }, { commandId: "c2", expectedVersion: 1 });
  engine.execute({ type: "reserve", sku: "A", orderId: "o1", quantity: 3 }, { commandId: "c3", expectedVersion: 2 });
  assert.throws(
    () => engine.execute({ type: "ship", sku: "A", orderId: "o1", quantity: 5 }, { commandId: "c4", expectedVersion: 3 }),
    ValidationError,
  );
});

test("command on non-existent SKU throws ValidationError", () => {
  const engine = new InventoryEngine();
  assert.throws(
    () => engine.execute({ type: "receive", sku: "NOPE", quantity: 5 }, { commandId: "c1", expectedVersion: 0 }),
    ValidationError,
  );
});

test("state on non-existent SKU throws ValidationError", () => {
  const engine = new InventoryEngine();
  assert.throws(
    () => engine.state("NOPE"),
    ValidationError,
  );
});

// ============================================================
// Deep immutability tests
// ============================================================

test("state() returns deep copy — mutations do not affect engine", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  engine.execute({ type: "receive", sku: "A", quantity: 10 }, { commandId: "c2", expectedVersion: 1 });
  const s = engine.state("A");
  s.onHand = 999;
  s.reservations["evil"] = 999;
  assert.equal(engine.state("A").onHand, 10);
  assert.deepEqual(engine.state("A").reservations, {});
});

test("history() returns deep copy — mutations do not affect engine", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  engine.execute({ type: "receive", sku: "A", quantity: 10 }, { commandId: "c2", expectedVersion: 1 });
  const h = engine.history("A");
  h[0].sku = "HACKED";
  h[1].data = { evil: true };
  assert.equal(engine.history("A")[0].sku, "A");
  assert.equal((engine.history("A")[1].data as Record<string, unknown>).quantity, 10);
});

test("command result is a deep copy", () => {
  const engine = new InventoryEngine();
  const r1 = engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  r1.sku = "HACKED";
  const r2 = engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  assert.equal(r2.sku, "A");
});

// ============================================================
// Batch tests
// ============================================================

test("executeBatch applies all commands atomically", () => {
  const engine = new InventoryEngine();
  const results = engine.executeBatch([
    { command: { type: "create-sku", sku: "A" }, commandId: "b1", expectedVersion: 0 },
    { command: { type: "receive", sku: "A", quantity: 20 }, commandId: "b2", expectedVersion: 1 },
  ]);
  assert.equal(results.length, 2);
  assert.deepEqual(engine.state("A"), {
    sku: "A", onHand: 20, reserved: 0, available: 20, reservations: {}, version: 2,
  });
});

test("executeBatch rolls back on failure", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c0", expectedVersion: 0 });
  assert.throws(() => engine.executeBatch([
    { command: { type: "receive", sku: "A", quantity: 10 }, commandId: "b1", expectedVersion: 1 },
    { command: { type: "receive", sku: "A", quantity: 5 }, commandId: "b2", expectedVersion: 0 }, // wrong version
  ]));
  // Nothing should have changed
  assert.deepEqual(engine.state("A"), {
    sku: "A", onHand: 0, reserved: 0, available: 0, reservations: {}, version: 1,
  });
});

test("batch across multiple SKUs", () => {
  const engine = new InventoryEngine();
  const results = engine.executeBatch([
    { command: { type: "create-sku", sku: "A" }, commandId: "b1", expectedVersion: 0 },
    { command: { type: "create-sku", sku: "B" }, commandId: "b2", expectedVersion: 0 },
    { command: { type: "receive", sku: "A", quantity: 10 }, commandId: "b3", expectedVersion: 1 },
    { command: { type: "receive", sku: "B", quantity: 5 }, commandId: "b4", expectedVersion: 1 },
  ]);
  assert.equal(results.length, 4);
  assert.equal(engine.state("A").onHand, 10);
  assert.equal(engine.state("B").onHand, 5);
});

test("batch rollback preserves idempotency", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c0", expectedVersion: 0 });
  assert.throws(() => engine.executeBatch([
    { command: { type: "receive", sku: "A", quantity: 10 }, commandId: "b1", expectedVersion: 1 },
    { command: { type: "receive", sku: "A", quantity: 5 }, commandId: "b2", expectedVersion: 0 },
  ]));
  // b1 should NOT have been recorded as idempotent
  const r = engine.execute({ type: "receive", sku: "A", quantity: 10 }, { commandId: "b1", expectedVersion: 1 });
  assert.equal(r.version, 2);
});

test("batch with intra-batch version chain", () => {
  const engine = new InventoryEngine();
  const results = engine.executeBatch([
    { command: { type: "create-sku", sku: "X" }, commandId: "b1", expectedVersion: 0 },
    { command: { type: "receive", sku: "X", quantity: 10 }, commandId: "b2", expectedVersion: 1 },
    { command: { type: "receive", sku: "X", quantity: 5 }, commandId: "b3", expectedVersion: 2 },
    { command: { type: "reserve", sku: "X", orderId: "o1", quantity: 3 }, commandId: "b4", expectedVersion: 3 },
  ]);
  assert.equal(results.length, 4);
  assert.deepEqual(engine.state("X"), {
    sku: "X", onHand: 15, reserved: 3, available: 12, reservations: { "o1": 3 }, version: 4,
  });
});

// ============================================================
// Log export/import tests
// ============================================================

test("exportLog produces valid JSONL with manifest", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  const log = engine.exportLog();
  const lines = log.split("\n");
  // Last element is "" from trailing newline; second-to-last is manifest
  assert.equal(lines[lines.length - 1], "");
  const manifest = JSON.parse(lines[lines.length - 2]);
  assert.equal(manifest.type, "manifest");
  assert.equal(manifest.eventCount, 1);
});

test("fromLog restores byte-for-byte identical export", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  engine.execute({ type: "receive", sku: "A", quantity: 10 }, { commandId: "c2", expectedVersion: 1 });
  const log1 = engine.exportLog();
  const restored = InventoryEngine.fromLog(log1);
  const log2 = restored.exportLog();
  assert.equal(log1, log2);
});

test("fromLog detects tampered event", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  let log = engine.exportLog();
  // Tamper with an event line
  const lines = log.split("\n");
  lines[0] = lines[0].replace('"A"', '"B"');
  log = lines.join("\n");
  assert.throws(() => InventoryEngine.fromLog(log), ValidationError);
});

test("fromLog detects truncated log", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  engine.execute({ type: "receive", sku: "A", quantity: 10 }, { commandId: "c2", expectedVersion: 1 });
  const log = engine.exportLog();
  // Remove last event line (keep first + manifest)
  const lines = log.split("\n");
  const truncated = lines[0] + "\n" + lines[lines.length - 2] + "\n";
  assert.throws(() => InventoryEngine.fromLog(truncated), ValidationError);
});

test("fromLog detects malformed JSON", () => {
  assert.throws(() => InventoryEngine.fromLog("not json\n"), ValidationError);
});

test("fromLog with empty log", () => {
  // An empty log is one with only a manifest line
  const emptyLog = JSON.stringify({ type: "manifest", eventCount: 0, headHash: "" }) + "\n";
  const engine = InventoryEngine.fromLog(emptyLog);
  // Should have no state
  assert.throws(() => engine.state("A"), ValidationError);
});

// ============================================================
// Continuation after restore
// ============================================================

test("engine continues after fromLog with correct positions and hashes", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  engine.execute({ type: "receive", sku: "A", quantity: 10 }, { commandId: "c2", expectedVersion: 1 });
  const log = engine.exportLog();
  const restored = InventoryEngine.fromLog(log);
  // Continue with a new command
  const r = restored.execute({ type: "receive", sku: "A", quantity: 5 }, { commandId: "c3", expectedVersion: 2 });
  assert.equal(r.version, 3);
  assert.equal(r.position, 3);
  // Re-export and compare
  const log2 = restored.exportLog();
  // Should be valid
  const reRestored = InventoryEngine.fromLog(log2);
  assert.deepEqual(reRestored.state("A"), {
    sku: "A", onHand: 15, reserved: 0, available: 15, reservations: {}, version: 3,
  });
});

test("idempotency works after fromLog with original command IDs", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  const log = engine.exportLog();
  const restored = InventoryEngine.fromLog(log);
  // Retry same command that was already applied before export
  const r = restored.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  assert.equal(r.version, 1);
  assert.equal(r.position, 1);
  // No new event appended
  assert.equal(restored.exportLog(), log);
});

// ============================================================
// Multi-SKU history
// ============================================================

test("history returns only events for the requested SKU", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  engine.execute({ type: "create-sku", sku: "B" }, { commandId: "c2", expectedVersion: 0 });
  engine.execute({ type: "receive", sku: "A", quantity: 10 }, { commandId: "c3", expectedVersion: 1 });
  engine.execute({ type: "receive", sku: "B", quantity: 5 }, { commandId: "c4", expectedVersion: 1 });

  const hA = engine.history("A");
  assert.equal(hA.length, 2);
  assert.equal(hA[0].sku, "A");
  assert.equal(hA[1].sku, "A");

  const hB = engine.history("B");
  assert.equal(hB.length, 2);
  assert.equal(hB[0].sku, "B");
  assert.equal(hB[1].sku, "B");
});

// ============================================================
// Full lifecycle with release
// ============================================================

test("full lifecycle: create, receive, reserve, release", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "DESK" }, { commandId: "c1", expectedVersion: 0 });
  engine.execute({ type: "receive", sku: "DESK", quantity: 20 }, { commandId: "c2", expectedVersion: 1 });
  engine.execute({ type: "reserve", sku: "DESK", orderId: "o1", quantity: 5 }, { commandId: "c3", expectedVersion: 2 });
  engine.execute({ type: "release", sku: "DESK", orderId: "o1", quantity: 3 }, { commandId: "c4", expectedVersion: 3 });

  assert.deepEqual(engine.state("DESK"), {
    sku: "DESK",
    onHand: 20,
    reserved: 2,
    available: 18,
    reservations: { "o1": 2 },
    version: 4,
  });
});

// ============================================================
// Release on unknown order
// ============================================================

test("release on unknown order throws ValidationError", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  engine.execute({ type: "receive", sku: "A", quantity: 10 }, { commandId: "c2", expectedVersion: 1 });
  assert.throws(
    () => engine.execute({ type: "release", sku: "A", orderId: "ghost", quantity: 1 }, { commandId: "c3", expectedVersion: 2 }),
    ValidationError,
  );
});

// ============================================================
// Hash chain continuity test
// ============================================================

test("events have correct hash chain", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "A" }, { commandId: "c1", expectedVersion: 0 });
  engine.execute({ type: "receive", sku: "A", quantity: 10 }, { commandId: "c2", expectedVersion: 1 });
  engine.execute({ type: "receive", sku: "A", quantity: 5 }, { commandId: "c3", expectedVersion: 2 });

  const h = engine.history("A");
  assert.equal(h[0].previousHash, null);
  // All events for SKU A are interleaved globally, so check the global log
  const log = engine.exportLog();
  const lines = log.split("\n").filter((l) => l && !l.includes('"type":"manifest"'));
  const events = lines.map((l) => JSON.parse(l));
  assert.equal(events[0].previousHash, null);
  assert.equal(events[1].previousHash, events[0].hash);
  assert.equal(events[2].previousHash, events[1].hash);
});
