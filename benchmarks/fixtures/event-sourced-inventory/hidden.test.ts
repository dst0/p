import * as assert from "node:assert/strict";
import { test } from "node:test";
import { ConcurrencyError, InventoryEngine, ValidationError } from "../src/index.ts";

function execute(engine, command, commandId, expectedVersion) {
  return engine.execute(command, { commandId, expectedVersion });
}

function createReceivedEngine(quantity = 10) {
  const engine = new InventoryEngine();
  execute(engine, { type: "create-sku", sku: "A" }, "create", 0);
  execute(engine, { type: "receive", sku: "A", quantity }, "receive", 1);
  return engine;
}

function createTwoSkuEngine() {
  const engine = new InventoryEngine();
  execute(engine, { type: "create-sku", sku: "A" }, "create-a", 0);
  execute(engine, { type: "create-sku", sku: "B" }, "create-b", 0);
  execute(engine, { type: "receive", sku: "A", quantity: 10 }, "receive-a", 1);
  execute(engine, { type: "receive", sku: "B", quantity: 3 }, "receive-b", 1);
  return engine;
}

function createExportedLog() {
  const engine = createReceivedEngine(7);
  execute(engine, { type: "reserve", sku: "A", orderId: "one", quantity: 2 }, "reserve", 2);
  return { engine, exported: engine.exportLog() };
}

test("[inventory:idempotent-result] exact retry returns the original result", () => {
  const engine = new InventoryEngine();
  execute(engine, { type: "create-sku", sku: "A" }, "create", 0);
  const first = execute(engine, { type: "receive", sku: "A", quantity: 8 }, "receive", 1);
  const retried = execute(engine, { type: "receive", sku: "A", quantity: 8 }, "receive", 1);
  assert.deepEqual(retried, first);
});

test("[inventory:idempotent-log] exact retry does not append or increment version", () => {
  const engine = new InventoryEngine();
  execute(engine, { type: "create-sku", sku: "A" }, "create", 0);
  execute(engine, { type: "receive", sku: "A", quantity: 8 }, "receive", 1);
  const before = engine.exportLog();
  execute(engine, { type: "receive", sku: "A", quantity: 8 }, "receive", 1);
  assert.equal(engine.exportLog(), before);
  assert.equal(engine.state("A").version, 2);
});

test("[inventory:conflicting-retry] same command ID with changed data is rejected", () => {
  const engine = new InventoryEngine();
  execute(engine, { type: "create-sku", sku: "A" }, "create", 0);
  execute(engine, { type: "receive", sku: "A", quantity: 8 }, "receive", 1);
  assert.throws(
    () => execute(engine, { type: "receive", sku: "A", quantity: 9 }, "receive", 2),
    ValidationError,
  );
});

test("[inventory:cross-command-id] command ID reuse across commands is rejected", () => {
  const engine = new InventoryEngine();
  execute(engine, { type: "create-sku", sku: "A" }, "same", 0);
  assert.throws(
    () => execute(engine, { type: "receive", sku: "A", quantity: 8 }, "same", 2),
    ValidationError,
  );
});

function failingBatch(engine) {
  return () => engine.executeBatch([
    {
      command: { type: "reserve", sku: "A", orderId: "batch-order", quantity: 4 },
      commandId: "batch-a",
      expectedVersion: 2,
    },
    {
      command: { type: "reserve", sku: "B", orderId: "batch-order", quantity: 4 },
      commandId: "batch-b",
      expectedVersion: 2,
    },
  ]);
}

test("[inventory:batch-state-rollback] failed batch restores every SKU state", () => {
  const engine = createTwoSkuEngine();
  const beforeStateA = engine.state("A");
  const beforeStateB = engine.state("B");
  assert.throws(failingBatch(engine), ValidationError);
  assert.deepEqual(engine.state("A"), beforeStateA);
  assert.deepEqual(engine.state("B"), beforeStateB);
});

test("[inventory:batch-log-rollback] failed batch leaves the event log unchanged", () => {
  const engine = createTwoSkuEngine();
  const beforeLog = engine.exportLog();
  assert.throws(failingBatch(engine), ValidationError);
  assert.equal(engine.exportLog(), beforeLog);
});

test("[inventory:batch-id-rollback] failed batch does not consume command IDs", () => {
  const engine = createTwoSkuEngine();
  assert.throws(failingBatch(engine), ValidationError);
  const results = engine.executeBatch([
    {
      command: { type: "reserve", sku: "A", orderId: "batch-order", quantity: 4 },
      commandId: "batch-a",
      expectedVersion: 2,
    },
    {
      command: { type: "reserve", sku: "B", orderId: "batch-order", quantity: 2 },
      commandId: "batch-b",
      expectedVersion: 2,
    },
  ]);
  assert.equal(results.length, 2);
});

test("[inventory:batch-ordered-commit] successful batch commits ordered cross-SKU effects", () => {
  const engine = createTwoSkuEngine();
  engine.executeBatch([
    {
      command: { type: "reserve", sku: "A", orderId: "batch-order", quantity: 4 },
      commandId: "batch-a",
      expectedVersion: 2,
    },
    {
      command: { type: "reserve", sku: "B", orderId: "batch-order", quantity: 2 },
      commandId: "batch-b",
      expectedVersion: 2,
    },
  ]);
  assert.equal(engine.state("A").available, 6);
  assert.equal(engine.state("B").available, 1);
});

function createFullyReservedEngine() {
  const engine = createReceivedEngine();
  execute(engine, { type: "reserve", sku: "A", orderId: "one", quantity: 6 }, "reserve-one", 2);
  execute(engine, { type: "reserve", sku: "A", orderId: "two", quantity: 4 }, "reserve-two", 3);
  return engine;
}

test("[inventory:no-oversell] reservation cannot exceed available inventory", () => {
  const engine = createFullyReservedEngine();
  assert.throws(
    () => execute(engine, { type: "reserve", sku: "A", orderId: "three", quantity: 1 }, "oversell", 4),
    ValidationError,
  );
});

test("[inventory:no-over-release] release cannot exceed the order reservation", () => {
  const engine = createFullyReservedEngine();
  assert.throws(
    () => execute(engine, { type: "release", sku: "A", orderId: "one", quantity: 7 }, "over-release", 4),
    ValidationError,
  );
});

test("[inventory:no-over-ship] shipment cannot exceed the order reservation", () => {
  const engine = createFullyReservedEngine();
  assert.throws(
    () => execute(engine, { type: "ship", sku: "A", orderId: "two", quantity: 5 }, "over-ship", 4),
    ValidationError,
  );
});

test("[inventory:release-ship-state] valid release and ship update all inventory totals", () => {
  const engine = createFullyReservedEngine();
  execute(engine, { type: "release", sku: "A", orderId: "one", quantity: 2 }, "release", 4);
  execute(engine, { type: "ship", sku: "A", orderId: "two", quantity: 3 }, "ship", 5);
  assert.deepEqual(engine.state("A"), {
    sku: "A",
    onHand: 7,
    reserved: 5,
    available: 2,
    reservations: { one: 4, two: 1 },
    version: 6,
  });
});

function createHistoryEngine() {
  const engine = new InventoryEngine();
  execute(engine, { type: "create-sku", sku: "A" }, "create-a", 0);
  execute(engine, { type: "create-sku", sku: "B" }, "create-b", 0);
  execute(engine, { type: "receive", sku: "A", quantity: 3 }, "receive-a", 1);
  execute(engine, { type: "reserve", sku: "A", orderId: "one", quantity: 1 }, "reserve-a", 2);
  return engine;
}

test("[inventory:state-isolation] returned state is a deep copy", () => {
  const engine = createHistoryEngine();
  const state = engine.state("A");
  state.reservations.one = 99;
  assert.equal(engine.state("A").reservations.one, 1);
});

test("[inventory:history-isolation] returned history is a deep copy", () => {
  const engine = createHistoryEngine();
  const history = engine.history("A");
  history[0].sku = "MUTATED";
  assert.equal(engine.history("A")[0].sku, "A");
});

test("[inventory:positions-versions] histories preserve per-SKU versions and global positions", () => {
  const engine = createHistoryEngine();
  assert.deepEqual(engine.history("A").map((event) => event.version), [1, 2, 3]);
  assert.deepEqual(engine.history("A").map((event) => event.position), [1, 3, 4]);
  assert.deepEqual(engine.history("B").map((event) => event.position), [2]);
});

test("[inventory:deterministic-newline-log] export is deterministic and newline terminated", () => {
  const { engine, exported } = createExportedLog();
  assert.equal(exported, engine.exportLog());
  assert.ok(exported.endsWith("\n"));
});

test("[inventory:manifest-integrity] manifest records the event count and head hash", () => {
  const { exported } = createExportedLog();
  const lines = exported.trimEnd().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.at(-1).type, "manifest");
  assert.equal(lines.at(-1).eventCount, 3);
  assert.match(lines.at(-1).headHash, /^[a-f0-9]{64}$/);
});

test("[inventory:hash-links] every event hash links to its predecessor", () => {
  const { exported } = createExportedLog();
  const lines = exported.trimEnd().split("\n").map((line) => JSON.parse(line));
  for (let index = 0; index < lines.length - 1; index += 1) {
    assert.match(lines[index].hash, /^[a-f0-9]{64}$/);
    assert.equal(lines[index].previousHash, index === 0 ? null : lines[index - 1].hash);
  }
});

test("[inventory:restore-byte-identity] restored engine exports byte-identical JSONL", () => {
  const { exported } = createExportedLog();
  const restored = InventoryEngine.fromLog(exported);
  assert.equal(restored.exportLog(), exported);
});

test("[inventory:restore-continuation] restored engine continues positions and hash links", () => {
  const { exported } = createExportedLog();
  const lines = exported.trimEnd().split("\n").map((line) => JSON.parse(line));
  const restored = InventoryEngine.fromLog(exported);
  execute(restored, { type: "receive", sku: "A", quantity: 1 }, "after-restore", 3);
  const resumedLines = restored.exportLog().trimEnd().split("\n").map((line) => JSON.parse(line));
  assert.equal(resumedLines.at(-1).eventCount, 4);
  assert.equal(resumedLines.at(-2).position, 4);
  assert.equal(resumedLines.at(-2).previousHash, lines.at(-2).hash);
});

test("[inventory:content-tamper] changed event content is rejected", () => {
  const { exported } = createExportedLog();
  const tampered = exported.replace('"quantity":7', '"quantity":70');
  assert.notEqual(tampered, exported);
  assert.throws(() => InventoryEngine.fromLog(tampered), ValidationError);
});

test("[inventory:truncation] removing the final byte is rejected", () => {
  const { exported } = createExportedLog();
  assert.throws(() => InventoryEngine.fromLog(exported.slice(0, -1)), ValidationError);
});

test("[inventory:extra-data] data after the manifest is rejected", () => {
  const { exported } = createExportedLog();
  assert.throws(() => InventoryEngine.fromLog(exported + "{}\n"), ValidationError);
});

test("[inventory:invalid-input-rollback] invalid input consumes neither command ID nor position", () => {
  const engine = new InventoryEngine();
  assert.throws(
    () => execute(engine, { type: "create-sku", sku: "  " }, "invalid", 0),
    ValidationError,
  );
  execute(engine, { type: "create-sku", sku: "A" }, "invalid", 0);
  assert.equal(engine.history("A").at(-1).position, 1);
});

test("[inventory:stale-batch-rollback] stale batch consumes neither command IDs nor positions", () => {
  const engine = new InventoryEngine();
  execute(engine, { type: "create-sku", sku: "A" }, "create", 0);
  assert.throws(
    () => engine.executeBatch([
      {
        command: { type: "receive", sku: "A", quantity: 2 },
        commandId: "batch-good",
        expectedVersion: 1,
      },
      {
        command: { type: "receive", sku: "A", quantity: 3 },
        commandId: "batch-stale",
        expectedVersion: 1,
      },
    ]),
    ConcurrencyError,
  );
  assert.equal(engine.history("A").length, 1);
  execute(engine, { type: "receive", sku: "A", quantity: 2 }, "batch-good", 1);
  assert.equal(engine.history("A").at(-1).position, 2);
});
