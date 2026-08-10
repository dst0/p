import * as assert from "node:assert/strict";
import { test } from "node:test";
import { ConcurrencyError, WorkflowEngine } from "../src/index.ts";

const definition = {
  workflowId: "release",
  tasks: [
    { id: "build", maxAttempts: 2, retryDelayMs: 10, compensate: true },
    { id: "test", dependsOn: ["build"] },
    { id: "deploy", dependsOn: ["test"], compensate: true },
  ],
};

test("runs a dependency-ordered workflow", () => {
  const engine = new WorkflowEngine();
  engine.start(definition, { commandId: "start", now: 0 });
  const build = engine.claim("worker-a", 0, 50);
  assert.equal(build?.taskId, "build");
  const buildRes = engine.complete(build!, { artifact: "sha256:abc" }, { commandId: "build-ok", now: 1 });
  assert.deepEqual(buildRes.output, { artifact: "sha256:abc" });
  const testClaim = engine.claim("worker-b", 1, 50);
  assert.equal(testClaim?.taskId, "test");
  engine.complete(testClaim!, { passed: true }, { commandId: "test-ok", now: 2 });
  const deploy = engine.claim("worker-a", 2, 50);
  assert.equal(deploy?.taskId, "deploy");
  engine.complete(deploy!, { region: "au" }, { commandId: "deploy-ok", now: 3 });
  assert.equal(engine.state("release").status, "succeeded");
});

test("fences stale leases and retries with virtual time", () => {
  const engine = new WorkflowEngine();
  engine.start({ workflowId: "retry", tasks: [{ id: "job", maxAttempts: 2, retryDelayMs: 10 }] }, { commandId: "s", now: 0 });
  const first = engine.claim("worker-a", 0, 5)!;
  const second = engine.claim("worker-b", 5, 5)!;
  assert.equal(second.attempt, 2);
  assert.throws(
    () => engine.complete(first, "late", { commandId: "late", now: 5 }),
    ConcurrencyError,
  );
  engine.complete(second, "ok", { commandId: "ok", now: 6 });
  assert.equal(engine.state("retry").status, "succeeded");
});

test("round-trips the durable log", () => {
  const engine = new WorkflowEngine();
  engine.start({ workflowId: "persist", tasks: [{ id: "one" }] }, { commandId: "start-p", now: 0 });
  const claim = engine.claim("worker", 0, 10)!;
  engine.complete(claim, { value: 1 }, { commandId: "done-p", now: 1 });
  const log = engine.exportLog();
  const restored = WorkflowEngine.fromLog(log);
  assert.equal(restored.exportLog(), log);
  assert.deepEqual(restored.state("persist"), engine.state("persist"));
});
