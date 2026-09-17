import assert from "node:assert/strict";
import { test } from "node:test";
import { parseKiloRecording } from "../../src/workloads/recording-metrics.ts";

function step(id: string, cost: unknown, location: "event" | "part" | "tokens" = "tokens") {
  const tokens = { input: 1, output: 2, total: 3, ...(location === "tokens" ? { cost } : {}) };
  return {
    type: "step_finish",
    ...(location === "event" ? { cost } : {}),
    part: { id, type: "step-finish", model: "backend/model", tokens, ...(location === "part" ? { cost } : {}) },
  };
}

test("Kilo accumulates numeric and object costs across every step", () => {
  const metrics = parseKiloRecording([
    step("one", 0.125),
    step("two", { total: 0.25 }, "part"),
    step("three", 0.375, "event"),
  ]);
  assert.deepEqual(metrics.usage.cost, { total: 0.75 });
  assert.equal(metrics.usage.totalTokens, 9);
});

test("Kilo rejects malformed, negative, and non-finite step costs", () => {
  for (const cost of [-1, Number.NaN, Number.POSITIVE_INFINITY, {}, { total: -1 }, { total: "1" }]) {
    const metrics = parseKiloRecording([step("invalid", cost)]);
    assert.match(metrics.errors.join("\n"), /invalid Kilo monetary cost/iu);
    assert.equal(metrics.usage.cost, undefined);
  }
});
