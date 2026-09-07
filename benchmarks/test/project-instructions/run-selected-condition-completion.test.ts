import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  conditionConfiguration,
  type PairedSample,
  type ProjectInstructionCondition,
} from "../../src/project-instructions/run-core.ts";
import { runPairedBenchmarkSchedule } from "../../src/project-instructions/run-schedule.ts";

function passingSample(run: number, task: string, condition: ProjectInstructionCondition): PairedSample {
  const configuration = conditionConfiguration(condition);
  return {
    run,
    task,
    condition,
    mode: configuration.projectInstructionMode,
    taskVerificationMode: configuration.taskVerificationMode,
    status: "passed",
    elapsedMs: 1,
    quality: { passed: true, rawScore: 1, maxScore: 1, checks: [{ passed: true }] },
    metrics: { usage: { totalTokens: 1 } },
  };
}

const SELECTED_CONDITION_SETS = [
  ["legacy", "compiled-evidence"],
  ["legacy", "compiled-evidence", "compiled-audit"],
] as const;

function scheduleFor(conditions: readonly ProjectInstructionCondition[]) {
  return Array.from({ length: 3 }, (_, index) => ({
    run: index + 1,
    task: "typescript-calculator",
    conditions: [...conditions],
  }));
}

for (const conditions of SELECTED_CONDITION_SETS) {
  test(`schedule completion requires all selected ${conditions.length} conditions for every run`, async () => {
    const root = mkdtempSync(join(tmpdir(), "p-selected-condition-completion-"));
    const schedule = scheduleFor(conditions);
    const document: Parameters<typeof runPairedBenchmarkSchedule>[0]["document"] = {
      candidateVersion: "5.0.1-rc.64",
      generatedAt: "2026-09-01T00:00:00.000Z",
      model: "provider/model",
      binarySha256: "a".repeat(64),
      seed: "selected-conditions",
      runs: 3,
      tasks: ["typescript-calculator"],
      conditions: [...conditions],
      schedule,
      samples: [] as PairedSample[],
      completed: false,
      gate: { passed: false },
    };
    try {
      await runPairedBenchmarkSchedule(
        {
          options: {} as never,
          output: join(root, "output"),
          scratchRoot: join(root, "scratch"),
          runtimeSnapshot: root,
          runtimeSha256: "a".repeat(64),
          schedule,
          document,
          deadline: Date.now() + 60_000,
          repoRoot: root,
        },
        {
          hashRuntime: () => "a".repeat(64),
          runCell: async ({ pair, condition }) => passingSample(pair.run, pair.task, condition),
          writeEvidence: () => {},
          setExitCode: () => assert.fail("a complete selected-condition schedule must not set an error exit code"),
        },
      );
      assert.equal(document.samples.length, conditions.length * 3);
      assert.equal(document.completed, true);
      assert.deepEqual(document.gate, { passed: true });
      assert.equal(document.runStatus, "completed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const mismatch of [
  {
    name: "condition",
    sample: (run: number, task: string) => passingSample(run, task, "compiled-audit"),
  },
  {
    name: "run",
    sample: (_run: number, task: string, condition: ProjectInstructionCondition) => passingSample(99, task, condition),
  },
  {
    name: "task",
    sample: (run: number, _task: string, condition: ProjectInstructionCondition) =>
      passingSample(run, "wrong-task", condition),
  },
] as const) {
  test(`schedule hard-stops when a child returns the wrong ${mismatch.name} identity`, async () => {
    const root = mkdtempSync(join(tmpdir(), "p-selected-condition-mismatch-"));
    const conditions = [...SELECTED_CONDITION_SETS[0]];
    const schedule = scheduleFor(conditions);
    const document: Parameters<typeof runPairedBenchmarkSchedule>[0]["document"] = {
      candidateVersion: "5.0.1-rc.64",
      generatedAt: "2026-09-01T00:00:00.000Z",
      model: "provider/model",
      binarySha256: "a".repeat(64),
      seed: "selected-conditions",
      runs: 3,
      tasks: ["typescript-calculator"],
      conditions,
      schedule,
      samples: [],
      completed: false,
      gate: { passed: false },
    };
    let exitCode: number | undefined;
    try {
      await runPairedBenchmarkSchedule(
        {
          options: {} as never,
          output: join(root, "output"),
          scratchRoot: join(root, "scratch"),
          runtimeSnapshot: root,
          runtimeSha256: "a".repeat(64),
          schedule,
          document,
          deadline: Date.now() + 60_000,
          repoRoot: root,
        },
        {
          hashRuntime: () => "a".repeat(64),
          runCell: async ({ pair, condition }) => mismatch.sample(pair.run, pair.task, condition),
          writeEvidence: () => {},
          setExitCode: (value) => {
            exitCode = value;
          },
        },
      );
      assert.equal(document.completed, false);
      assert.equal(document.gate.passed, false);
      assert.equal(document.runStatus, "failed");
      assert.equal(exitCode, 2);
      assert.match(document.gate.failure?.reason ?? "", /mismatched cell identity/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("schedule hard-stops when one scheduled identity is missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-selected-condition-missing-"));
  const conditions = [...SELECTED_CONDITION_SETS[0]];
  const schedule = scheduleFor(conditions);
  const document: Parameters<typeof runPairedBenchmarkSchedule>[0]["document"] = {
    candidateVersion: "5.0.1-rc.64",
    generatedAt: "2026-09-01T00:00:00.000Z",
    model: "provider/model",
    binarySha256: "a".repeat(64),
    seed: "selected-conditions",
    runs: 3,
    tasks: ["typescript-calculator"],
    conditions,
    schedule,
    samples: [],
    completed: false,
    gate: { passed: false },
  };
  let callCount = 0;
  try {
    await runPairedBenchmarkSchedule(
      {
        options: {} as never,
        output: join(root, "output"),
        scratchRoot: join(root, "scratch"),
        runtimeSnapshot: root,
        runtimeSha256: "a".repeat(64),
        schedule,
        document,
        deadline: Date.now() + 60_000,
        repoRoot: root,
      },
      {
        hashRuntime: () => "a".repeat(64),
        runCell: async ({ pair, condition }) => {
          callCount += 1;
          if (callCount === schedule.length * conditions.length) throw new Error("missing final scheduled sample");
          return passingSample(pair.run, pair.task, condition);
        },
        writeEvidence: () => {},
        setExitCode: () => {},
      },
    );
    assert.equal(document.samples.length, schedule.length * conditions.length - 1);
    assert.equal(document.completed, false);
    assert.equal(document.gate.passed, false);
    assert.equal(document.runStatus, "failed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
