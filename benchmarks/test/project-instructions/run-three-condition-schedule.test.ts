import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPairedSchedule,
  conditionConfiguration,
  PROJECT_INSTRUCTION_CONDITIONS,
} from "../../src/project-instructions/run-core.ts";

test("three benchmark conditions isolate instruction delivery from audit cost", () => {
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

test("three-way schedule is reproducible and position-balanced for three to five runs", () => {
  for (const runs of [3, 4, 5]) {
    const schedule = buildPairedSchedule(["one", "two"], runs, "three-condition-seed");
    assert.deepEqual(schedule, buildPairedSchedule(["one", "two"], runs, "three-condition-seed"));
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
