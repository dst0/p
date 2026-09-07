import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  auditEvidenceHandle,
  callTaskVerification,
  createRequirementAuditHarness,
  recordAuditToolResult,
  recordProductionMutationForTest,
} from "./task-requirement-audit-test-harness.ts";

const execFileAsync = promisify(execFile);

async function createMutatedTask() {
  const harness = createRequirementAuditHarness();
  await callTaskVerification(harness.controller, {
    action: "declare_task",
    task_kind: "feature",
    task_summary: "Verify the inventory rollback behavior",
  });
  await recordProductionMutationForTest(harness);
  return harness;
}

async function createAuthorizedRegression() {
  const harness = createRequirementAuditHarness();
  await callTaskVerification(harness.controller, {
    action: "declare_task",
    task_kind: "bug_fix",
    task_summary: "Fix the inventory rollback regression",
  });
  await callTaskVerification(harness.controller, {
    action: "authorize_baseline_test",
    test_paths: ["test/inventory.test.ts"],
  });
  await recordAuditToolResult(harness.agent, "write", {
    path: "test/inventory.test.ts",
    content: "test('rollback', () => {});\n",
  });
  return harness;
}

describe("runtime assertion output evidence", () => {
  it("reproduces Node console.assert logging a failure while exiting zero", async () => {
    const result = await execFileAsync(process.execPath, [
      "-e",
      'console.assert(false, "rollback changed state"); console.log("continued")',
    ]);

    expect(result.stdout).toContain("continued");
    expect(result.stderr).toContain("Assertion failed: rollback changed state");
  });

  it("rejects an executed manual reproduction when console.assert fails with exit zero", async () => {
    const harness = await createMutatedTask();
    const evidenceRef = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: 'node --import tsx -e "console.assert(false); console.log("ALL CHECKS PASSED")"' },
        { text: "Assertion failed: batch state changed\nALL CHECKS PASSED" },
      ),
    );

    const result = await callTaskVerification(harness.controller, {
      action: "record_final",
      final_method: "manual_reproduction",
      final_status: "passed",
      expected_behavior: "A failed batch preserves all inventory state",
      observed_behavior: "The manual reproduction reported success",
      evidence_refs: [evidenceRef],
      unresolved_failures: [],
    });

    expect(harness.controller.evidence.get(evidenceRef)?.isError).toBe(true);
    expect(result.toLowerCase()).toContain("failed evidence");
  });

  it("does not reinterpret read-only search output as an executed assertion failure", async () => {
    const harness = await createMutatedTask();
    const evidenceRef = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: 'rg -n "Assertion failed" docs' },
        { text: "docs/example.md:4:Assertion failed: example output" },
      ),
    );

    expect(harness.controller.evidence.get(evidenceRef)?.isError).toBe(false);
  });

  it("does not accept a synthesized zero-exit assertion failure as a failing regression", async () => {
    const harness = await createAuthorizedRegression();
    const evidenceRef = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "node --test test/inventory.test.ts" },
        { text: "Assertion failed: rollback changed state" },
      ),
    );

    const result = await callTaskVerification(harness.controller, {
      action: "record_baseline",
      baseline_method: "failing_regression_test",
      hypothesis: "A failed batch changes inventory state",
      conclusion: "The focused regression reproduces the state change",
      evidence_refs: [evidenceRef],
      unresolved_assumptions: [],
    });

    expect(result).toContain("native failing focused-test evidence");
  });

  it("accepts a genuine nonzero focused-test failure as a failing regression", async () => {
    const harness = await createAuthorizedRegression();
    const evidenceOutput = await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "node --test test/inventory.test.ts" },
      { isError: true, text: "Assertion failed: rollback changed state" },
    );
    const evidenceRef = auditEvidenceHandle(evidenceOutput);
    expect(evidenceOutput).not.toContain("zero process exit");

    const result = await callTaskVerification(harness.controller, {
      action: "record_baseline",
      baseline_method: "failing_regression_test",
      hypothesis: "A failed batch changes inventory state",
      conclusion: "The focused regression reproduces the state change",
      evidence_refs: [evidenceRef],
      unresolved_assumptions: [],
    });

    expect(result).toContain("Baseline verification recorded");
  });
});
