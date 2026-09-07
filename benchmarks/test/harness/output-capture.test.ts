import assert from "node:assert/strict";
import test from "node:test";

import {
  BenchmarkCollectionOverflowError,
  BenchmarkOutputOverflowError,
  captureOverflowEvidence,
  createBenchmarkTurnAggregate,
  createBoundedTextCapture,
} from "../../src/harness/output-capture.ts";
import { createBenchmarkEventCapture } from "../../src/project-instructions/stream.ts";

test("bounded text capture counts UTF-8 bytes and preserves exact decoded text", () => {
  const capture = createBoundedTextCapture("test output", 7);
  capture.append("a");
  capture.append("😀");
  capture.append("bc");
  assert.equal(capture.byteLength, 7);
  assert.equal(capture.value(), "a😀bc");
});

test("collection overflow reports structured count evidence", () => {
  const aggregate = createBenchmarkTurnAggregate({ maxRuntimeContexts: 1 });
  aggregate.append({ stdout: "", stderr: "", runtimeContexts: [{}], userTurns: [] });
  assert.throws(
    () => aggregate.append({ stdout: "", stderr: "", runtimeContexts: [{}], userTurns: [] }),
    (error) => {
      assert.equal(error instanceof BenchmarkCollectionOverflowError, true);
      assert.deepEqual(captureOverflowEvidence(error, 4), {
        kind: "capture_overflow",
        captureName: "combined runtime contexts",
        limitCount: 1,
        observedCountAtLeast: 2,
        turn: 4,
      });
      return true;
    },
  );
});

test("bounded text capture rejects overflow without retaining the rejected chunk", () => {
  const capture = createBoundedTextCapture("test output", 4);
  capture.append("test");
  assert.throws(
    () => capture.append("!"),
    (error) =>
      error instanceof BenchmarkOutputOverflowError && error.captureName === "test output" && error.limitBytes === 4,
  );
  assert.equal(capture.value(), "test");
});

test("metric and combined captures fail explicitly at their independent bounds", () => {
  const events = createBenchmarkEventCapture(new Set(["result"]), 0, { maxMetricBytes: 32 });
  assert.throws(
    () => events.process(JSON.stringify({ type: "result", value: "x".repeat(64) })),
    /metric output exceeded 32 bytes/,
  );

  const aggregate = createBenchmarkTurnAggregate({ maxCombinedStdoutBytes: 4 });
  aggregate.append({ stdout: "test", stderr: "", runtimeContexts: [], userTurns: [] });
  assert.throws(
    () => aggregate.append({ stdout: "!", stderr: "", runtimeContexts: [], userTurns: [] }),
    /combined metric output exceeded 4 bytes/,
  );
  assert.equal(aggregate.stdout.value(), "test");

  const stderrAggregate = createBenchmarkTurnAggregate({ maxCombinedStderrBytes: 4 });
  assert.throws(
    () => stderrAggregate.append({ stdout: "", stderr: "error", runtimeContexts: [], userTurns: [] }),
    /combined stderr exceeded 4 bytes/,
  );

  const countedEvents = createBenchmarkEventCapture(new Set(["result"]), 0, {
    maxMetricBytes: 1024,
    maxMetricEvents: 1,
  });
  countedEvents.process('{"type":"result"}');
  assert.throws(() => countedEvents.process('{"type":"result"}'), /metric events exceeded 1 entries/);
});
