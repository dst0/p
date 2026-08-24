import assert from "node:assert/strict";
import { test } from "node:test";
import { assessSample, verifyResolvedPModel } from "../../src/project-instructions/run-core.ts";

test("non-passed samples preserve model identity without hiding their run status", () => {
  const timedOut = {
    mode: "legacy",
    run: 1,
    task: "typescript-calculator",
    status: "timed_out",
    elapsedMs: 900_000,
    metrics: {
      model: { provider: "provider", id: "model", api: "openai-completions" },
      usage: { totalTokens: 123 },
    },
    quality: { passed: true, rawScore: 6, maxScore: 6, checks: [{ name: "contract", passed: true }] },
  };

  assert.deepEqual(verifyResolvedPModel("provider/model", timedOut.metrics, { requireResponseModel: false }), {
    provider: "provider",
    id: "model",
    api: "openai-completions",
    responseModel: undefined,
  });
  assert.deepEqual(assessSample(timedOut), { passed: false, reason: "run status timed_out" });
});
