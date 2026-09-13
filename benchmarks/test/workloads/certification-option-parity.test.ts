import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

const base = ["--certified", "--model", "surface/model", "--expected-resolved-model", "backend/model", "--runs", "3"];

test("certified mode explicitly binds P to the default evidence verification profile", () => {
  const options = parseRunnerArgs(base);
  assert.equal(options.taskVerificationMode, "evidence");
});

test("certified mode rejects asymmetric verification and compiler-model overrides", () => {
  for (const extra of [
    ["--task-verification", "off"],
    ["--task-verification", "audit"],
    ["--project-instruction-compiler-model", "other/model"],
  ]) {
    assert.throws(() => parseRunnerArgs([...base, ...extra]), /Certified mode.*(?:evidence|compiler model)/u);
  }
});
