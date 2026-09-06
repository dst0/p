import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { didAgentTurnFail } from "../../src/agents/turn-policy.ts";
import type { PairedSample, ProjectInstructionCondition } from "../../src/project-instructions/run-core.ts";
import {
  assertChildSampleMetrics,
  assessSample,
  buildPairedSchedule,
  conditionConfiguration,
  createBenchmarkGateFailure,
  describeProjectInstructionStartupFailure,
  parsePairedArgs,
  verifyResolvedPModel,
} from "../../src/project-instructions/run-core.ts";
import { renderPairedReport } from "../../src/project-instructions/run-report.ts";

function sample(
  condition: ProjectInstructionCondition,
  run: number,
  overrides: Record<string, unknown> = {},
): PairedSample {
  const configuration = conditionConfiguration(condition);
  return {
    condition,
    mode: configuration.projectInstructionMode,
    taskVerificationMode: configuration.taskVerificationMode,
    run,
    task: "typescript-calculator",
    status: "passed",
    elapsedMs: condition === "legacy" ? 1000 : 800,
    metrics: { usage: { totalTokens: condition === "legacy" ? 100 : 80 } },
    quality: {
      passed: true,
      rawScore: 10,
      score: 10,
      maxScore: 10,
      checks: [{ name: "contract", passed: true }],
    },
    ...overrides,
  } as PairedSample;
}

test("failed agent turns stop without watchdog nudges", () => {
  assert.equal(didAgentTurnFail({ code: 0, signal: null, error: undefined }), false);
  assert.equal(didAgentTurnFail({ code: 86, signal: null, error: undefined }), true);
  assert.equal(didAgentTurnFail({ code: null, signal: "SIGTERM", error: undefined }), true);
  assert.equal(
    didAgentTurnFail({ code: undefined, signal: undefined, error: "spawn failed" } as unknown as Parameters<
      typeof didAgentTurnFail
    >[0]),
    true,
  );
});

test("paired arguments require three to five repetitions", () => {
  const parsed = parsePairedArgs([
    "--model",
    "provider/model",
    "--runs",
    "5",
    "--task",
    "monolith-split",
    "--thinking",
    "off",
  ]);
  assert.equal(parsed.runs, 5);
  assert.equal(parsed.compilerModel, "provider/model");
  assert.deepEqual(parsed.tasks, ["monolith-split"]);
  assert.deepEqual(parsed.conditions, ["legacy", "compiled-evidence"]);
  assert.equal(parsed.thinking, "off");
  assert.deepEqual(parsePairedArgs(["--model", "provider/model", "--include-audit"]).conditions, [
    "legacy",
    "compiled-evidence",
    "compiled-audit",
  ]);
  assert.equal(
    parsePairedArgs(["--model", "task-provider/task-model", "--compiler-model", "compiler-provider/compiler/model"])
      .compilerModel,
    "compiler-provider/compiler/model",
  );
  assert.throws(() => parsePairedArgs(["--model", "provider/model", "--runs", "2"]), /between 3 and 5/u);
  assert.throws(() => parsePairedArgs(["--model", "provider/model", "--runs", "6"]), /between 3 and 5/u);
  assert.throws(
    () => parsePairedArgs(["--model", "provider/model", "--thinking", "unknown"]),
    /must be off, minimal, low, medium, high, or xhigh/u,
  );
});

test("sample model identity must resolve to the requested provider and model", () => {
  assert.deepEqual(
    verifyResolvedPModel("provider/model/version", {
      model: { provider: "provider", id: "model/version", api: "openai-responses" },
      responseModel: "backend-model",
      usage: { totalTokens: 1 },
    }),
    { provider: "provider", id: "model/version", api: "openai-responses", responseModel: "backend-model" },
  );
  assert.throws(
    () =>
      verifyResolvedPModel("provider/model", {
        model: { provider: "other", id: "model", api: "api" },
        responseModel: "model",
        usage: { totalTokens: 1 },
      }),
    /identity mismatch/u,
  );
  assert.throws(
    () =>
      verifyResolvedPModel("provider/model", {
        model: { provider: "provider", id: "model", api: "api" },
        usage: { totalTokens: 1 },
      }),
    /response model/u,
  );
});

test("paired schedule randomizes order reproducibly inside every block", () => {
  const first = buildPairedSchedule(["one", "two"], 3, "reproducible-seed");
  const second = buildPairedSchedule(["one", "two"], 3, "reproducible-seed");
  assert.deepEqual(first, second);
  assert.equal(first.length, 6);
  for (const pair of first) assert.deepEqual([...pair.conditions].sort(), ["compiled-evidence", "legacy"]);
});

test("base benchmark runner accepts the explicit P instruction mode", () => {
  const result = spawnSync(
    process.execPath,
    [
      "benchmarks/src/run-agents.ts",
      "--agents",
      "p",
      "--model",
      "provider/model",
      "--project-instructions",
      "compiled",
      "--project-instruction-compiler-model",
      "compiler-provider/compiler-model",
      "--minimum-timeout-seconds",
      "1200",
      "--task",
      "not-a-fixture",
    ],
    { cwd: new URL("../../..", import.meta.url), encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown task: not-a-fixture/u);
  assert.doesNotMatch(result.stderr, /Unknown option/u);
});

test("correctness gate rejects incomplete, timed-out, and failed-quality samples", () => {
  assert.deepEqual(assessSample(sample("compiled-evidence", 1)), { passed: true });
  assert.match(assessSample(sample("compiled-evidence", 1, { status: "timed_out" })).reason ?? "", /status timed_out/u);
  assert.match(
    assessSample(sample("compiled-evidence", 1, { quality: { passed: false, rawScore: 9, maxScore: 10, checks: [] } }))
      .reason ?? "",
    /quality gate/u,
  );
  assert.match(
    assessSample(sample("compiled-evidence", 1, { quality: { passed: true, rawScore: 10, maxScore: 10, checks: [] } }))
      .reason ?? "",
    /quality gate/u,
  );
  assert.match(
    assessSample(
      sample("compiled-evidence", 1, { quality: { passed: true, checks: [{ name: "contract", passed: true }] } }),
    ).reason ?? "",
    /quality gate/u,
  );
});

test("safe compiler startup diagnostics take precedence over incomplete metrics", () => {
  const result = {
    status: "failed",
    exitCode: 86,
    elapsedMs: 600,
    metrics: { usage: { totalTokens: 0 } },
    quality: { maxScore: 0, checks: [] },
    projectInstructionEvidence: {
      cache: {
        manifest: {
          mode: "fallback",
          compilerStatus: "failed",
          compilerDiagnostic: "project instruction compiler model context capacity was insufficient",
        },
      },
    },
  };
  assert.equal(
    describeProjectInstructionStartupFailure(result),
    result.projectInstructionEvidence.cache.manifest.compilerDiagnostic,
  );
  assert.throws(() => assertChildSampleMetrics(result), /model context capacity was insufficient/u);
});

test("compiler certification gate rejects forged telemetry and raw errors", () => {
  const error = Object.assign(new Error("Authorization: private-secret"), {
    compilerFailure: {
      attemptCount: 1,
      failureKinds: ["envelope"],
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
      elapsedMs: 3,
    },
  });
  const failure = createBenchmarkGateFailure({ run: 0, task: "compiler-certification" }, "compiled", error, {
    compilerCertification: true,
  });
  assert.deepEqual(failure, {
    run: 0,
    task: "compiler-certification",
    mode: "compiled",
    reason: "project instruction compiler certification failed",
  });
  assert.doesNotMatch(JSON.stringify(failure), /Authorization|private-secret|envelope/u);
});

test("failed report suppresses performance conclusions", () => {
  const compilerFailure = {
    attemptCount: 2,
    failureKinds: ["envelope", "constraint-set"],
    usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, total: 12 },
    elapsedMs: 123,
  };
  const report = renderPairedReport({
    generatedAt: "2026-08-22T00:00:00.000Z",
    model: "provider/model",
    thinking: "off",
    seed: "seed",
    runs: 3,
    tasks: ["typescript-calculator"],
    binarySha256: "abc",
    candidateVersion: "5.0.1-rc.1",
    completed: false,
    schedule: [
      {
        run: 1,
        task: "typescript-calculator",
        conditions: ["compiled-evidence", "legacy", "compiled-audit"],
      },
    ],
    samples: [sample("compiled-evidence", 1, { status: "failed" })],
    gate: {
      passed: false,
      failure: {
        mode: "compiled",
        run: 1,
        task: "typescript-calculator",
        reason: "quality gate failed",
        compilerFailure,
      },
    },
  });
  assert.match(report, /HARD STOP/u);
  assert.match(report, /Task thinking level: `off`/u);
  assert.match(report, /Compiler telemetry: 2 attempts; envelope, constraint-set; 12 tokens; 123 ms/u);
  assert.match(report, /No token or runtime comparison is reported/u);
  assert.doesNotMatch(report, /Median total tokens/u);
});

test("in-progress evidence never claims the correctness gate passed", () => {
  const report = renderPairedReport({
    generatedAt: "2026-08-22T00:00:00.000Z",
    candidateVersion: "5.0.1-rc.1",
    model: "provider/model",
    seed: "seed",
    runs: 3,
    tasks: ["typescript-calculator"],
    binarySha256: "abc",
    schedule: [],
    samples: [],
    compilerPreparation: { usage: { total: 777 }, elapsedMs: 1234 },
    completed: false,
    gate: { passed: true },
  });
  assert.match(report, /RUNNING/u);
  assert.match(report, /Candidate version: `5\.0\.1-rc\.1`/u);
  assert.match(report, /Task thinking level: `default`/u);
  assert.match(report, /One-time certified compiler preparation: \*\*777 tokens\*\*, \*\*1,234 ms\*\*/u);
  assert.doesNotMatch(report, /Compiler tokens/u);
  assert.doesNotMatch(report, /Correctness gate: \*\*PASSED\*\*/u);
});
