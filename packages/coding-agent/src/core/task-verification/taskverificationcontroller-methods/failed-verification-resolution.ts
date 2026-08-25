import { GENERIC_CHECK_PATTERN } from "../constants.ts";
import { isShellTool } from "../tool-classification.ts";
import type { TaskVerificationEvidence } from "../types.ts";
import { commandContainsTestInvocation, focusedTestInvocation } from "./test-command-invocation.ts";
import { hasPositivePassingTestResult, testInvocationCovers } from "./test-invocation-selection.ts";

export function resolveLatestFailedVerificationEvidence(
  evidence: Iterable<TaskVerificationEvidence>,
  mutationRevision: number,
): TaskVerificationEvidence[] {
  const current = [...evidence].filter(
    (item) => item.mutationRevision === mutationRevision && isShellTool(item.toolName),
  );
  const latestGenericByCommand = new Map<string, TaskVerificationEvidence>();
  for (const item of current) {
    if (GENERIC_CHECK_PATTERN.test(item.descriptor)) latestGenericByCommand.set(item.descriptor, item);
  }

  const failedTests = current.filter((item, index) => {
    if (!item.isError || !commandContainsTestInvocation(item.descriptor)) return false;
    return !current.slice(index + 1).some((later) => supersedesFailedTest(later, item));
  });
  const failedGenerics = [...latestGenericByCommand.values()].filter((item) => item.isError);
  const failures = new Set([...failedTests, ...failedGenerics]);
  return current.filter((item) => failures.has(item));
}

export function isVerificationCommand(descriptor: string): boolean {
  return GENERIC_CHECK_PATTERN.test(descriptor) || commandContainsTestInvocation(descriptor);
}

function supersedesFailedTest(later: TaskVerificationEvidence, failed: TaskVerificationEvidence): boolean {
  if (later.descriptor === failed.descriptor) {
    return later.isError || hasPositivePassingTestResult(later.outputSummary);
  }
  if (later.isError || !hasPositivePassingTestResult(later.outputSummary)) return false;
  const laterInvocation = focusedTestInvocation(later.descriptor);
  const failedInvocation = focusedTestInvocation(failed.descriptor);
  return (
    laterInvocation !== undefined &&
    failedInvocation !== undefined &&
    testInvocationCovers(laterInvocation, failedInvocation)
  );
}
