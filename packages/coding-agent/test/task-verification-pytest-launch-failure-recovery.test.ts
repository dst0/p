import { describe, expect, it } from "vitest";
import {
  callTaskVerification,
  createRequirementAuditHarness,
  recordAuditToolResult,
  recordProductionMutationForTest,
} from "./task-requirement-audit-test-harness.ts";

async function createHarness() {
  const harness = createRequirementAuditHarness();
  await callTaskVerification(harness.controller, {
    action: "declare_task",
    task_kind: "feature",
    task_summary: "Implement and verify the input behavior",
  });
  await recordProductionMutationForTest(harness);
  return harness;
}

async function failedThenPassing(failedCommand: string, failedOutput: string, passingCommand: string) {
  const harness = await createHarness();
  await recordAuditToolResult(harness.agent, "bash", { command: failedCommand }, { isError: true, text: failedOutput });
  await recordAuditToolResult(harness.agent, "bash", { command: passingCommand }, { text: "1 passed in 0.01s" });
  return harness.controller.latestFailedVerificationEvidence();
}

const usageError = "ERROR: Wrong expression passed to '-k': expected end of input";
const plainFilter = 'python -m pytest test_result.py -v -k "invalid input is rejected" -s';
const matchingNodeId = 'python -m pytest "test_result.py::test_invalid_input_is_rejected" -v -s';

describe("pytest launch-failure recovery", () => {
  it("accepts a passing node ID that exactly covers a malformed plain name filter", async () => {
    expect(await failedThenPassing(plainFilter, usageError, matchingNodeId)).toEqual([]);
  });

  it.each([
    [
      "a genuine assertion failure",
      plainFilter,
      "AssertionError: invalid input was accepted\n1 failed in 0.01s",
      matchingNodeId,
    ],
    [
      "a boolean selector",
      'python -m pytest test_result.py -k "invalid or truncated"',
      usageError,
      'python -m pytest "test_result.py::test_invalid_or_truncated"',
    ],
    [
      "a nested class node",
      plainFilter,
      usageError,
      'python -m pytest "test_result.py::InventoryTests::test_invalid_input_is_rejected"',
    ],
    ["a different file", plainFilter, usageError, 'python -m pytest "other_result.py::test_invalid_input_is_rejected"'],
    [
      "a different working directory",
      `cd package-a && ${plainFilter}`,
      usageError,
      `cd package-b && ${matchingNodeId}`,
    ],
    [
      "a unittest command containing pytest substrings",
      'python -m unittest pytest.py -k "invalid input is rejected"',
      usageError,
      'python -m unittest "pytest.py::test_invalid_input_is_rejected"',
    ],
    [
      "a multi-file pytest launch",
      'python -m pytest first.py second.py -k "invalid input is rejected"',
      usageError,
      'python -m pytest "first.py::test_invalid_input_is_rejected"',
    ],
    [
      "repeated name filters",
      'python -m pytest test_result.py -k "invalid input is rejected" -k "another expression"',
      usageError,
      matchingNodeId,
    ],
    [
      "an additional directory target",
      'python -m pytest test_result.py tests/ -k "invalid input is rejected"',
      usageError,
      matchingNodeId,
    ],
    [
      "an additional glob target",
      'python -m pytest test_result.py "tests/*.py" -k "invalid input is rejected"',
      usageError,
      matchingNodeId,
    ],
  ])("does not retire %s", async (_label, failedCommand, failedOutput, passingCommand) => {
    expect(await failedThenPassing(failedCommand, failedOutput, passingCommand)).toHaveLength(1);
  });
});
