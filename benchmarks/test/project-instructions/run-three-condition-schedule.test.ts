import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPairedSchedule,
  conditionConfiguration,
  DEFAULT_PROJECT_INSTRUCTION_CONDITIONS,
  PROJECT_INSTRUCTION_CONDITIONS,
} from "../../src/project-instructions/run-core.ts";

test("the canonical benchmark compares free-text compiled delivery with legacy", () => {
  assert.deepEqual(DEFAULT_PROJECT_INSTRUCTION_CONDITIONS, ["legacy", "compiled-evidence"]);
  assert.deepEqual(PROJECT_INSTRUCTION_CONDITIONS, ["legacy", "compiled-evidence", "compiled-audit"]);
  assert.deepEqual(conditionConfiguration("legacy"), {
    projectInstructionMode: "legacy",
    taskVerificationMode: "evidence",
  });
  assert.deepEqual(conditionConfiguration("compiled-evidence"), {
    projectInstructionMode: "compiled",
    taskVerificationMode: "evidence",
  });
  assert.deepEqual(conditionConfiguration("compiled-audit"), {
    projectInstructionMode: "compiled",
    taskVerificationMode: "audit",
  });
});

test("the default paired schedule is reproducible and position-balanced for three to five runs", () => {
  for (const runs of [3, 4, 5]) {
    const schedule = buildPairedSchedule(["one", "two"], runs, "paired-condition-seed");
    assert.deepEqual(schedule, buildPairedSchedule(["one", "two"], runs, "paired-condition-seed"));
    assert.equal(schedule.length, runs * 2);
    for (const block of schedule) {
      assert.deepEqual([...block.conditions].sort(), [...DEFAULT_PROJECT_INSTRUCTION_CONDITIONS].sort());
    }
    for (const task of ["one", "two"]) {
      const blocks = schedule.filter((block) => block.task === task);
      for (let position = 0; position < DEFAULT_PROJECT_INSTRUCTION_CONDITIONS.length; position += 1) {
        const counts = DEFAULT_PROJECT_INSTRUCTION_CONDITIONS.map(
          (condition) => blocks.filter((block) => block.conditions[position] === condition).length,
        );
        assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
      }
    }
  }
});

test("the semantic audit remains an explicit reproducible balanced canary", () => {
  for (const runs of [3, 4, 5]) {
    const schedule = buildPairedSchedule(["one", "two"], runs, "audit-canary-seed", [
      ...PROJECT_INSTRUCTION_CONDITIONS,
    ]);
    assert.deepEqual(
      schedule,
      buildPairedSchedule(["one", "two"], runs, "audit-canary-seed", [...PROJECT_INSTRUCTION_CONDITIONS]),
    );
    assert.equal(schedule.length, runs * 2);
    for (const block of schedule) {
      assert.deepEqual([...block.conditions].sort(), [...PROJECT_INSTRUCTION_CONDITIONS].sort());
    }
    for (const task of ["one", "two"]) {
      const blocks = schedule.filter((block) => block.task === task);
      for (let position = 0; position < PROJECT_INSTRUCTION_CONDITIONS.length; position += 1) {
        const counts = PROJECT_INSTRUCTION_CONDITIONS.map(
          (condition) => blocks.filter((block) => block.conditions[position] === condition).length,
        );
        assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
      }
    }
  }
});

test("condition order is seed-sensitive for paired and audit-canary schedules", () => {
  for (const conditions of [DEFAULT_PROJECT_INSTRUCTION_CONDITIONS, PROJECT_INSTRUCTION_CONDITIONS]) {
    assert.notDeepEqual(
      buildPairedSchedule(["one", "two", "three"], 5, "seed-a", [...conditions]),
      buildPairedSchedule(["one", "two", "three"], 5, "seed-b", [...conditions]),
    );
  }
});

test("selected condition validation accepts only the canonical pair or complete audit canary", () => {
  assert.deepEqual(
    buildPairedSchedule(["one"], 3, "order-insensitive-pair", ["compiled-evidence", "legacy"]),
    buildPairedSchedule(["one"], 3, "order-insensitive-pair", ["legacy", "compiled-evidence"]),
  );
  assert.deepEqual(
    buildPairedSchedule(["one"], 3, "order-insensitive-canary", ["compiled-audit", "compiled-evidence", "legacy"]),
    buildPairedSchedule(["one"], 3, "order-insensitive-canary", ["legacy", "compiled-evidence", "compiled-audit"]),
  );

  assert.throws(
    () => buildPairedSchedule(["one"], 3, "invalid", ["legacy"]),
    /Expected two release conditions or all three conditions with the audit canary/,
  );
  assert.throws(
    () => buildPairedSchedule(["one"], 3, "invalid", ["legacy", "compiled-audit"]),
    /must be exactly legacy, compiled-evidence in any order/,
  );
  assert.throws(
    () => buildPairedSchedule(["one"], 3, "invalid", ["compiled-evidence", "compiled-audit"]),
    /must be exactly legacy, compiled-evidence in any order/,
  );
  assert.throws(
    () => buildPairedSchedule(["one"], 3, "invalid", ["legacy", "legacy"]),
    /Duplicate benchmark condition/,
  );
  assert.throws(
    () => buildPairedSchedule(["one"], 3, "invalid", ["legacy", "compiled-evidence", "compiled-evidence"]),
    /Duplicate benchmark condition/,
  );
  assert.throws(
    () =>
      buildPairedSchedule(["one"], 3, "invalid", [
        "legacy",
        "unknown",
      ] as unknown as (typeof PROJECT_INSTRUCTION_CONDITIONS)[number][]),
    /Unknown benchmark condition unknown/,
  );
});
