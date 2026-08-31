import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conditionConfiguration,
  type PairedSample,
  PROJECT_INSTRUCTION_TASKS,
  type ProjectInstructionCondition,
} from "../../src/project-instructions/run-core.ts";
import { createPairedSummary } from "../../src/project-instructions/run-report.ts";

function sample(condition: ProjectInstructionCondition, task: string, run: number): PairedSample {
  const configuration = conditionConfiguration(condition);
  const value = condition === "legacy" ? 100 : condition === "compiled-evidence" ? 80 : 120;
  return {
    condition,
    mode: configuration.projectInstructionMode,
    taskVerificationMode: configuration.taskVerificationMode,
    run,
    task,
    status: "passed",
    elapsedMs: value * 10,
    metrics: { usage: { totalTokens: value } },
    quality: { passed: true, rawScore: 10, score: 10, maxScore: 10, checks: [{ passed: true }] },
  };
}

test("performance summary requires every canonical task and all three conditions", () => {
  const samples = PROJECT_INSTRUCTION_TASKS.flatMap((task) =>
    [1, 2, 3].flatMap((run) =>
      (["legacy", "compiled-evidence", "compiled-audit"] as const).map((condition) => sample(condition, task, run)),
    ),
  );
  const summary = createPairedSummary(samples, true, [...PROJECT_INSTRUCTION_TASKS], 3);
  assert.ok(summary);
  assert.equal(summary.byCondition["compiled-evidence"].medianTotalTokens, 80);
  assert.equal(summary.comparisons.compiledEvidenceVsLegacy.medianTokenDeltaPercent, -20);
  assert.equal(summary.comparisons.compiledAuditVsCompiledEvidence.medianTokenDeltaPercent, 50);
  assert.equal(createPairedSummary(samples, false, [...PROJECT_INSTRUCTION_TASKS], 3), undefined);
  assert.equal(createPairedSummary(samples, true, [PROJECT_INSTRUCTION_TASKS[0]], 3), undefined);
  assert.equal(createPairedSummary(samples.slice(0, -1), true, [...PROJECT_INSTRUCTION_TASKS], 3), undefined);
});
