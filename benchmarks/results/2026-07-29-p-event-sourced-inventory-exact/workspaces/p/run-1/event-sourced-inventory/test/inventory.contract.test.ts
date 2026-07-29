import * as assert from "node:assert/strict";
import { test } from "node:test";
import { ConcurrencyError, InventoryEngine, ValidationError } from "../src/index.ts";

test("executes the basic inventory lifecycle", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "BOOK" }, { commandId: "create", expectedVersion: 0 });
  engine.execute({ type: "receive", sku: "BOOK", quantity: 10 }, { commandId: "receive", expectedVersion: 1 });
  engine.execute({ type: "reserve", sku: "BOOK", orderId: "order-1", quantity: 4 }, { commandId: "reserve", expectedVersion: 2 });
  engine.execute({ type: "ship", sku: "BOOK", orderId: "order-1", quantity: 3 }, { commandId: "ship", expectedVersion: 3 });

  assert.deepEqual(engine.state("BOOK"), {
    sku: "BOOK",
    onHand: 7,
    reserved: 1,
    available: 6,
    reservations: { "order-1": 1 },
    version: 4,
  });
});

test("enforces optimistic concurrency and inventory invariants", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "CHAIR" }, { commandId: "create", expectedVersion: 0 });
  assert.throws(
    () => engine.execute({ type: "receive", sku: "CHAIR", quantity: 2 }, { commandId: "stale", expectedVersion: 0 }),
    ConcurrencyError,
  );
  assert.throws(
    () => engine.execute({ type: "reserve", sku: "CHAIR", orderId: "order-2", quantity: 1 }, { commandId: "reserve", expectedVersion: 1 }),
    ValidationError,
  );
});

test("replays an exported log", () => {
  const original = new InventoryEngine();
  original.execute({ type: "create-sku", sku: "LAMP" }, { commandId: "create", expectedVersion: 0 });
  original.execute({ type: "receive", sku: "LAMP", quantity: 5 }, { commandId: "receive", expectedVersion: 1 });

  const restored = InventoryEngine.fromLog(original.exportLog());
  assert.deepEqual(restored.state("LAMP"), original.state("LAMP"));
  assert.deepEqual(restored.history("LAMP"), original.history("LAMP"));
});
