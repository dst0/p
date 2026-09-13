import assert from "node:assert/strict";
import { test } from "node:test";
import { createBenchmarkEventCapture } from "../../src/project-instructions/stream.ts";
import { evaluateCertification } from "../../src/workloads/certification.ts";
import {
  createPRecordingMetricsAccumulator,
  parseKiloRecording,
  parseRecording,
} from "../../src/workloads/recording-metrics.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";
import { createSyntheticCertifiedMatrix } from "./certification-matrix-fixture.ts";

const pEvent = (responseModel: string, cost: unknown) => ({
  type: "message_end",
  message: {
    role: "assistant",
    responseModel,
    model: undefined as string | undefined,
    content: [],
    stopReason: "stop",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost },
  },
});

const serialized = (events: readonly unknown[]): string => events.map((event) => JSON.stringify(event)).join("\n");

test("stream capture preserves malformed JSON as a metric error", () => {
  const observed: Record<string, unknown>[] = [];
  const capture = createBenchmarkEventCapture(new Set(["error", "step_finish"]), 0, {
    onMetricEvent: (event) => observed.push(event),
  });
  assert.equal(capture.process("{malformed"), false);
  assert.equal(capture.metricEventCount, 1);
  assert.deepEqual(observed, [{ type: "error", message: "Malformed JSONL recording event", benchmarkEventOrdinal: 1 }]);
  assert.match(capture.metricOutput, /Malformed JSONL recording event/u);
});

test("P and Pi preserve invalid streamed cost evidence even after a later valid cost", () => {
  for (const agent of ["p", "pi"] as const) {
    for (const invalid of [-1, {}, { total: -1 }, { total: "1" }]) {
      const metrics = parseRecording(
        serialized([pEvent("expected/model", invalid), pEvent("expected/model", 0.25)]),
        agent,
      );
      assert.match(metrics.errors.join("\n"), new RegExp(`invalid ${agent} monetary cost`, "iu"));
      assert.deepEqual(metrics.usage.cost, { total: 0.25 });
    }
  }
});

test("P and Pi accumulators directly reject non-finite streamed costs", () => {
  for (const agent of ["p", "pi"] as const) {
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const accumulator = createPRecordingMetricsAccumulator(agent);
      accumulator.observe(pEvent("expected/model", invalid));
      accumulator.observe(pEvent("expected/model", 0.25));
      const metrics = accumulator.snapshot();
      assert.match(metrics.errors.join("\n"), new RegExp(`invalid ${agent} monetary cost`, "iu"));
      assert.deepEqual(metrics.usage.cost, { total: 0.25 });
    }
  }
});

test("conflicting model fields in one event are all retained", () => {
  for (const agent of ["p", "pi"] as const) {
    const event = pEvent("expected/model", 0.1);
    event.message.model = "wrong/model";
    assert.deepEqual(parseRecording(serialized([event]), agent).responseModels, ["expected/model", "wrong/model"]);
  }
  const kilo = parseKiloRecording([
    {
      type: "step_finish",
      responseModel: "wrong/model",
      part: { id: "1", type: "step-finish", model: "expected/model", tokens: {} },
    },
  ]);
  assert.deepEqual(kilo.responseModels, ["expected/model", "wrong/model"]);
});

test("P, Pi, and Kilo retain every observed response model in stream order", () => {
  for (const agent of ["p", "pi"] as const) {
    const metrics = parseRecording(
      serialized([pEvent("wrong/model", 0.1), pEvent("expected/model", 0.2), pEvent("wrong/model", 0.3)]),
      agent,
    );
    assert.deepEqual(metrics.responseModels, ["wrong/model", "expected/model"]);
    assert.equal(metrics.responseModel, "wrong/model");
  }
  const kilo = parseKiloRecording([
    { type: "step_finish", part: { id: "1", type: "step-finish", model: "wrong/model", tokens: {} } },
    { type: "step_finish", part: { id: "2", type: "step-finish", model: "expected/model", tokens: {} } },
  ]);
  assert.deepEqual(kilo.responseModels, ["wrong/model", "expected/model"]);
});

test("Kilo retains model evidence from protocol updates that metrics deduplicate", () => {
  const commonPart = { id: "same-step", type: "step-finish", state: { status: "completed" }, tokens: {} };
  const kilo = parseKiloRecording([
    { type: "step_finish", model: "expected/model", part: commonPart },
    { type: "step_finish", model: "wrong/model", part: commonPart },
  ]);
  assert.deepEqual(kilo.responseModels, ["expected/model", "wrong/model"]);
});

test("certification rejects a mixed response-model stream even when the last model is expected", () => {
  const options = parseRunnerArgs([
    "--certified",
    "--model",
    "surface/model",
    "--expected-resolved-model",
    "expected/model",
    "--runs",
    "3",
  ]);
  let changed = false;
  const rows = createSyntheticCertifiedMatrix({
    responseModel: "expected/model",
    modifyCell: (row) => {
      if (!changed && row.agent === "pi") {
        Object.assign(row.metrics!, { responseModels: ["wrong/model", "expected/model"] });
        changed = true;
      }
      return row;
    },
  });
  const result = evaluateCertification(rows, options);
  assert.equal(result.passed, false);
  assert.match(result.failures.join("\n"), /observed responseModel mismatch.*wrong\/model/iu);
});
