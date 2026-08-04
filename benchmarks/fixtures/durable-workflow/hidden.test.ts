import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { ConcurrencyError, ValidationError, WorkflowEngine } from "../src/index.ts";

function named(id: string, run: () => void | Promise<void>): void {
  test(`[workflow:${id}]`, run);
}

function start(tasks: object[], workflowId = "wf"): WorkflowEngine {
  const engine = new WorkflowEngine();
  engine.start({ workflowId, tasks }, { commandId: `start-${workflowId}`, now: 0 });
  return engine;
}

function claim(engine: WorkflowEngine, worker: string, now: number, leaseMs = 10) {
  const value = engine.claim(worker, now, leaseMs);
  assert.ok(value);
  return value;
}

function complete(engine: WorkflowEngine, worker: string, now: number, commandId: string) {
  const value = claim(engine, worker, now);
  engine.complete(value, { task: value.taskId }, { commandId, now: now + 1 });
  return value;
}

function lines(engine: WorkflowEngine): Record<string, unknown>[] {
  return engine
    .exportLog()
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
}

named("dag-order", () => {
  const engine = start([
    { id: "compile" },
    { id: "test", dependsOn: ["compile"] },
    { id: "deploy", dependsOn: ["test"] },
  ]);
  assert.equal(claim(engine, "w", 0).taskId, "compile");
  assert.ok(engine.claim("other", 0, 10) == null);
});

named("deterministic-order", () => {
  const engine = new WorkflowEngine();
  engine.start({ workflowId: "z", tasks: [{ id: "b" }, { id: "a" }] }, { commandId: "z", now: 0 });
  engine.start({ workflowId: "a", tasks: [{ id: "z" }] }, { commandId: "a", now: 0 });
  const first = claim(engine, "w1", 0);
  const second = claim(engine, "w2", 0);
  assert.deepEqual([first.workflowId, first.taskId], ["a", "z"]);
  assert.deepEqual([second.workflowId, second.taskId], ["z", "a"]);
});

named("cycle-validation", () => {
  const engine = new WorkflowEngine();
  const before = engine.exportLog();
  assert.throws(
    () =>
      engine.start(
        { workflowId: "cycle", tasks: [{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }] },
        { commandId: "cycle", now: 0 },
      ),
    ValidationError,
  );
  assert.throws(
    () => engine.start({ workflowId: "missing", tasks: [{ id: "a", dependsOn: ["x"] }] }, { commandId: "missing", now: 0 }),
    ValidationError,
  );
  assert.equal(engine.exportLog(), before);
});

named("definition-validation", () => {
  const invalid = [
    [{ id: "a" }, { id: "a" }],
    [{ id: "a", maxAttempts: 0 }],
    [{ id: "a", retryDelayMs: -1 }],
    [{ id: "a", dependsOn: ["a"] }],
  ];
  for (const [index, tasks] of invalid.entries()) {
    const engine = new WorkflowEngine();
    assert.throws(
      () => engine.start({ workflowId: `bad-${index}`, tasks }, { commandId: `bad-${index}`, now: 0 }),
      ValidationError,
    );
  }
});

named("monotonic-time", () => {
  const engine = start([{ id: "a" }]);
  const current = claim(engine, "w", 10);
  assert.throws(() => engine.heartbeat(current, 9, 10), ValidationError);
  assert.throws(() => engine.claim("x", 9, 10), ValidationError);
});

named("exclusive-lease", () => {
  const engine = start([{ id: "a" }]);
  const first = claim(engine, "w1", 0);
  assert.ok(engine.claim("w2", 9, 10) == null);
  assert.equal(first.leaseExpiresAt, 10);
});

named("heartbeat", () => {
  const engine = start([{ id: "a" }]);
  const first = claim(engine, "w1", 0);
  const renewed = engine.heartbeat(first, 5, 20);
  assert.equal(renewed.leaseExpiresAt, 25);
  assert.ok(engine.claim("w2", 20, 10) == null);
  assert.throws(() => engine.heartbeat({ ...first, workerId: "other" }, 20, 10), ConcurrencyError);
});

named("expiry-reclaim", () => {
  const engine = start([{ id: "a", maxAttempts: 3 }]);
  const first = claim(engine, "w1", 0, 5);
  const second = claim(engine, "w2", 5, 5);
  assert.equal(second.attempt, 2);
  assert.notEqual(second.leaseToken, first.leaseToken);
});

named("stale-fencing", () => {
  const engine = start([{ id: "a", maxAttempts: 3 }]);
  const first = claim(engine, "w1", 0, 5);
  const second = claim(engine, "w2", 5, 5);
  assert.throws(() => engine.complete(first, "late", { commandId: "late", now: 5 }), ConcurrencyError);
  engine.complete(second, "ok", { commandId: "ok", now: 6 });
  assert.throws(() => engine.complete(second, "again", { commandId: "again", now: 6 }), ConcurrencyError);
});

named("idempotent-result", () => {
  const engine = start([{ id: "a" }]);
  const current = claim(engine, "w", 0);
  const first = engine.complete(current, { nested: { value: 1 } }, { commandId: "done", now: 1 });
  const before = engine.exportLog();
  const retry = engine.complete(current, { nested: { value: 1 } }, { commandId: "done", now: 1 });
  assert.deepEqual(retry, first);
  assert.equal(engine.exportLog(), before);
});

named("conflicting-command", () => {
  const engine = start([{ id: "a" }]);
  const current = claim(engine, "w", 0);
  engine.complete(current, "ok", { commandId: "done", now: 1 });
  assert.throws(() => engine.cancel("wf", { commandId: "done", now: 1, reason: "different" }), ValidationError);
});

named("retry-backoff", () => {
  const engine = start([{ id: "a", maxAttempts: 3, retryDelayMs: 10 }]);
  const first = claim(engine, "w", 0);
  engine.fail(first, "first", { commandId: "f1", now: 1 });
  assert.ok(engine.claim("w", 10, 10) == null);
  const second = claim(engine, "w", 11);
  engine.fail(second, "second", { commandId: "f2", now: 12 });
  assert.ok(engine.claim("w", 31, 10) == null);
  assert.equal(claim(engine, "w", 32).attempt, 3);
});

named("attempt-exhaustion", () => {
  const engine = start([{ id: "a", maxAttempts: 1 }]);
  engine.fail(claim(engine, "w", 0), "fatal", { commandId: "fail", now: 1 });
  assert.equal(engine.state("wf").status, "failed");
  assert.ok(engine.claim("w", 1, 10) == null);
});

named("cancel-forward", () => {
  const engine = start([{ id: "a" }, { id: "b" }]);
  engine.cancel("wf", { commandId: "cancel", now: 1, reason: "operator" });
  assert.ok(engine.claim("w", 1, 10) == null);
  assert.equal(engine.state("wf").status, "cancelled");
});

named("compensation-order", () => {
  const engine = start([
    { id: "a", compensate: true },
    { id: "b", dependsOn: ["a"], compensate: true },
    { id: "c", dependsOn: ["b"] },
  ]);
  complete(engine, "w", 0, "a-ok");
  complete(engine, "w", 2, "b-ok");
  engine.cancel("wf", { commandId: "cancel", now: 4, reason: "stop" });
  const first = claim(engine, "w", 4);
  assert.deepEqual([first.mode, first.taskId], ["compensate", "b"]);
  engine.complete(first, "undone", { commandId: "b-undo", now: 5 });
  const second = claim(engine, "w", 5);
  assert.deepEqual([second.mode, second.taskId], ["compensate", "a"]);
  engine.complete(second, "undone", { commandId: "a-undo", now: 6 });
  assert.equal(engine.state("wf").status, "cancelled");
});

named("compensation-fencing", () => {
  const engine = start([
    { id: "a", compensate: true, maxAttempts: 3 },
    { id: "b", dependsOn: ["a"] },
  ]);
  complete(engine, "w", 0, "ok");
  engine.cancel("wf", { commandId: "cancel", now: 2, reason: "stop" });
  const stale = claim(engine, "w1", 2, 5);
  const current = claim(engine, "w2", 7, 5);
  assert.equal(current.mode, "compensate");
  assert.throws(() => engine.complete(stale, "late", { commandId: "late", now: 7 }), ConcurrencyError);
});

named("output-isolation", () => {
  const engine = start([{ id: "a" }]);
  const output = { nested: { value: 1 } };
  const result = engine.complete(claim(engine, "w", 0), output, { commandId: "done", now: 1 });
  output.nested.value = 9;
  result.output.nested.value = 8;
  assert.equal(engine.state("wf").tasks.a.output.nested.value, 1);
});

named("state-history-isolation", () => {
  const engine = start([{ id: "a" }]);
  const state = engine.state("wf");
  const history = engine.history("wf");
  state.tasks.a.status = "corrupt";
  history[0].type = "corrupt";
  assert.notEqual(engine.state("wf").tasks.a.status, "corrupt");
  assert.notEqual(engine.history("wf")[0].type, "corrupt");
});

named("positions-versions", () => {
  const engine = start([{ id: "a" }]);
  complete(engine, "w", 0, "done");
  const events = lines(engine).slice(0, -1);
  assert.deepEqual(events.map((event) => event.position), events.map((_, index) => index + 1));
  assert.deepEqual(events.map((event) => event.version), events.map((_, index) => index + 1));
});

named("deterministic-log", () => {
  const engine = start([{ id: "a" }]);
  complete(engine, "w", 0, "done");
  const first = engine.exportLog();
  assert.ok(first.endsWith("\n"));
  assert.equal(engine.exportLog(), first);
});

named("hash-manifest", () => {
  const engine = start([{ id: "a" }]);
  complete(engine, "w", 0, "done");
  const records = lines(engine);
  const manifest = records.at(-1);
  const events = records.slice(0, -1);
  assert.equal(manifest?.eventCount, events.length);
  assert.equal(manifest?.headHash, events.at(-1)?.hash);
  assert.equal(events[0].previousHash, null);
  for (let index = 1; index < events.length; index++) assert.equal(events[index].previousHash, events[index - 1].hash);
  for (const event of events) {
    assert.match(String(event.hash), /^[a-f0-9]{64}$/);
    const canonical = { ...event };
    delete canonical.hash;
    assert.equal(event.hash, createHash("sha256").update(JSON.stringify(canonical)).digest("hex"));
  }
});

named("restore-byte-identity", () => {
  const engine = start([{ id: "a" }]);
  complete(engine, "w", 0, "done");
  const log = engine.exportLog();
  assert.equal(WorkflowEngine.fromLog(log).exportLog(), log);
});

named("restore-continuation", () => {
  const engine = start([{ id: "a" }, { id: "b", dependsOn: ["a"] }]);
  complete(engine, "w", 0, "a");
  const restored = WorkflowEngine.fromLog(engine.exportLog());
  const beforeEvents = lines(restored).slice(0, -1);
  const current = claim(restored, "w", 2);
  assert.equal(current.taskId, "b");
  restored.complete(current, "ok", { commandId: "b", now: 3 });
  const afterEvents = lines(restored).slice(0, -1);
  const appended = afterEvents.slice(beforeEvents.length);
  assert.deepEqual(
    appended.map((event) => event.position),
    appended.map((_, index) => beforeEvents.length + index + 1),
  );
  assert.equal(appended[0]?.previousHash, beforeEvents.at(-1)?.hash);
});

named("content-tamper", () => {
  const engine = start([{ id: "a" }]);
  complete(engine, "w", 0, "done");
  const records = lines(engine);
  records[0].workflowId = "tampered";
  assert.throws(() => WorkflowEngine.fromLog(`${records.map(JSON.stringify).join("\n")}\n`), ValidationError);
});

named("truncation-extra", () => {
  const engine = start([{ id: "a" }]);
  const log = engine.exportLog();
  assert.throws(() => WorkflowEngine.fromLog(log.slice(0, -1)), ValidationError);
  assert.throws(() => WorkflowEngine.fromLog(`${log}{}\n`), ValidationError);
});

named("failed-mutation-rollback", () => {
  const engine = start([{ id: "a" }]);
  const before = engine.exportLog();
  assert.throws(() => engine.cancel("missing", { commandId: "reuse", now: 1, reason: "x" }), ValidationError);
  assert.equal(engine.exportLog(), before);
  engine.cancel("wf", { commandId: "reuse", now: 1, reason: "x" });
  assert.equal(engine.state("wf").status, "cancelled");
});
