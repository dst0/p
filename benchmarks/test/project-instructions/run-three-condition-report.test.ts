import assert from "node:assert/strict";
import { test } from "node:test";
import type { Tokens } from "marked";
import { marked } from "marked";
import {
  buildPairedSchedule,
  conditionConfiguration,
  type PairedSample,
  PROJECT_INSTRUCTION_TASKS,
  type ProjectInstructionCondition,
} from "../../src/project-instructions/run-core.ts";
import { createPairedSummary, renderPairedReport } from "../../src/project-instructions/run-report.ts";

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

test("performance summary requires every canonical task and both release conditions", () => {
  const samples = PROJECT_INSTRUCTION_TASKS.flatMap((task) =>
    [1, 2, 3].flatMap((run) =>
      (["legacy", "compiled-evidence"] as const).map((condition) => sample(condition, task, run)),
    ),
  );
  const conditions = ["legacy", "compiled-evidence"] as const;
  const summary = createPairedSummary(samples, true, [...PROJECT_INSTRUCTION_TASKS], 3, [...conditions]);
  assert.ok(summary);
  assert.equal(summary.byCondition["compiled-evidence"].medianTotalTokens, 80);
  assert.equal(summary.comparisons.compiledEvidenceVsLegacy.medianTokenDeltaPercent, -20);
  assert.equal("compiledAuditVsCompiledEvidence" in summary.comparisons, false);
  assert.equal(createPairedSummary(samples, false, [...PROJECT_INSTRUCTION_TASKS], 3, [...conditions]), undefined);
  assert.equal(createPairedSummary(samples, true, [PROJECT_INSTRUCTION_TASKS[0]], 3, [...conditions]), undefined);
  assert.equal(
    createPairedSummary(samples.slice(0, -1), true, [...PROJECT_INSTRUCTION_TASKS], 3, [...conditions]),
    undefined,
  );
});

test("audit comparisons are reported only for an explicitly complete canary", () => {
  const samples = PROJECT_INSTRUCTION_TASKS.flatMap((task) =>
    [1, 2, 3].flatMap((run) =>
      (["legacy", "compiled-evidence", "compiled-audit"] as const).map((condition) => sample(condition, task, run)),
    ),
  );
  const conditions = ["legacy", "compiled-evidence", "compiled-audit"] as const;
  const summary = createPairedSummary(samples, true, [...PROJECT_INSTRUCTION_TASKS], 3, [...conditions]);
  assert.ok(summary);
  assert.equal(summary.comparisons.compiledAuditVsCompiledEvidence?.medianTokenDeltaPercent, 50);
});

test("completed reports expose only the selected condition columns and comparisons", () => {
  for (const conditions of [
    ["legacy", "compiled-evidence"],
    ["legacy", "compiled-evidence", "compiled-audit"],
  ] as const) {
    const samples = PROJECT_INSTRUCTION_TASKS.flatMap((task) =>
      [1, 2, 3].flatMap((run) => conditions.map((condition) => sample(condition, task, run))),
    );
    const summary = createPairedSummary(samples, true, [...PROJECT_INSTRUCTION_TASKS], 3, [...conditions]);
    assert.ok(summary);
    const report = renderPairedReport({
      generatedAt: "2026-09-01T00:00:00.000Z",
      model: "provider/model",
      binarySha256: "a".repeat(64),
      seed: "report-seed",
      candidateVersion: "5.0.1-rc.64",
      runs: 3,
      tasks: [...PROJECT_INSTRUCTION_TASKS],
      conditions: [...conditions],
      schedule: buildPairedSchedule([...PROJECT_INSTRUCTION_TASKS], 3, "report-seed", [...conditions]),
      samples,
      summary,
      completed: true,
      gate: { passed: true },
    });
    const tables = marked.lexer(report).filter((token): token is Tokens.Table => token.type === "table");
    assert.equal(tables.length, 4);
    assert.equal(tables[0].header.length, conditions.length + 2);
    assert.equal(tables[0].rows.length, PROJECT_INSTRUCTION_TASKS.length * 3);
    assert.equal(tables[2].rows.length, conditions.length);
    assert.equal(tables[3].rows.length, PROJECT_INSTRUCTION_TASKS.length);
    if (conditions.length === 3) {
      assert.match(report, /Project-instruction audit-canary benchmark/u);
      assert.match(report, /\| First \| Second \| Third \|/u);
      assert.match(report, /compiled-audit vs compiled-evidence/u);
      assert.equal(tables[2].header.length, 5);
      assert.equal(tables[3].header.length, 6);
    } else {
      assert.match(report, /Project-instruction paired benchmark/u);
      assert.match(report, /\| First \| Second \|/u);
      assert.doesNotMatch(report, /\| First \| Second \| Third \|/u);
      assert.doesNotMatch(report, /compiled-audit/u);
      assert.equal(tables[2].header.length, 5);
      assert.equal(tables[3].header.length, 4);
    }
  }
});

test("paired reports ignore forged audit fields in a complete selected-condition summary", () => {
  const conditions = ["legacy", "compiled-evidence"] as const;
  const samples = PROJECT_INSTRUCTION_TASKS.flatMap((task) =>
    [1, 2, 3].flatMap((run) => conditions.map((condition) => sample(condition, task, run))),
  );
  const summary = createPairedSummary(samples, true, [...PROJECT_INSTRUCTION_TASKS], 3, [...conditions]);
  assert.ok(summary);
  const auditComparison = {
    samples: 12,
    medianTokenDeltaPercent: 50,
    medianRuntimeDeltaPercent: 50,
  };
  const report = renderPairedReport({
    generatedAt: "2026-09-01T00:00:00.000Z",
    model: "provider/model",
    binarySha256: "a".repeat(64),
    seed: "forged-summary-seed",
    candidateVersion: "5.0.1-rc.64",
    runs: 3,
    tasks: [...PROJECT_INSTRUCTION_TASKS],
    conditions: [...conditions],
    schedule: buildPairedSchedule([...PROJECT_INSTRUCTION_TASKS], 3, "forged-summary-seed", [...conditions]),
    samples,
    summary: {
      ...summary,
      comparisons: {
        ...summary.comparisons,
        compiledAuditVsCompiledEvidence: auditComparison,
        compiledAuditVsLegacy: auditComparison,
      },
    },
    completed: true,
    gate: { passed: true },
  });
  assert.doesNotMatch(report, /compiled-audit/u);
  assert.match(report, /## Performance after correctness/u);
});

test("incomplete audit samples suppress a forged complete performance summary", () => {
  const conditions = ["legacy", "compiled-evidence", "compiled-audit"] as const;
  const completeSamples = PROJECT_INSTRUCTION_TASKS.flatMap((task) =>
    [1, 2, 3].flatMap((run) => conditions.map((condition) => sample(condition, task, run))),
  );
  const summary = createPairedSummary(completeSamples, true, [...PROJECT_INSTRUCTION_TASKS], 3, [...conditions]);
  assert.ok(summary);
  const report = renderPairedReport({
    generatedAt: "2026-09-01T00:00:00.000Z",
    model: "provider/model",
    binarySha256: "a".repeat(64),
    seed: "incomplete-audit-seed",
    candidateVersion: "5.0.1-rc.64",
    runs: 3,
    tasks: [...PROJECT_INSTRUCTION_TASKS],
    conditions: [...conditions],
    schedule: buildPairedSchedule([...PROJECT_INSTRUCTION_TASKS], 3, "incomplete-audit-seed", [...conditions]),
    samples: completeSamples.slice(0, -1),
    summary,
    completed: true,
    gate: { passed: true },
  });
  assert.match(report, /Performance conclusions are suppressed/u);
  assert.doesNotMatch(report, /## Performance after correctness/u);
  assert.doesNotMatch(report, /Within-block median deltas/u);
});

test("running and failed documents suppress stale complete performance summaries", () => {
  const conditions = ["legacy", "compiled-evidence"] as const;
  const samples = PROJECT_INSTRUCTION_TASKS.flatMap((task) =>
    [1, 2, 3].flatMap((run) => conditions.map((condition) => sample(condition, task, run))),
  );
  const summary = createPairedSummary(samples, true, [...PROJECT_INSTRUCTION_TASKS], 3, [...conditions]);
  assert.ok(summary);
  const base = {
    generatedAt: "2026-09-01T00:00:00.000Z",
    model: "provider/model",
    binarySha256: "a".repeat(64),
    seed: "stale-summary-seed",
    candidateVersion: "5.0.1-rc.64",
    runs: 3,
    tasks: [...PROJECT_INSTRUCTION_TASKS],
    conditions: [...conditions],
    schedule: buildPairedSchedule([...PROJECT_INSTRUCTION_TASKS], 3, "stale-summary-seed", [...conditions]),
    samples,
    summary,
  };
  const runningReport = renderPairedReport({
    ...base,
    runStatus: "running",
    completed: false,
    gate: { passed: true },
  });
  const failedReport = renderPairedReport({
    ...base,
    runStatus: "failed",
    completed: false,
    gate: {
      passed: false,
      failure: { run: 1, task: PROJECT_INSTRUCTION_TASKS[0], mode: "legacy", reason: "failed sample" },
    },
  });
  for (const report of [runningReport, failedReport]) {
    assert.doesNotMatch(report, /## Performance after correctness/u);
    assert.doesNotMatch(report, /Within-block median deltas/u);
  }
});
