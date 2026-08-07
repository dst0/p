import {
  FOCUSED_TEST_PATTERN,
  GENERIC_CHECK_PATTERN,
  HIGH_RISK_PATTERN,
  READ_ONLY_PATTERN,
  TASK_VERIFICATION_TOOL_NAME,
  TEST_PATTERN,
} from "../constants.ts";
import {
  emptyReadiness,
  isFinalMethod,
  isShellTool,
  isStaticTool,
  normalizeStrings,
  normalizeText,
} from "../helpers-part1.ts";
import { behavioralFinalRequired, isCodeTask } from "../helpers-part2.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type { TaskVerificationEvidence, VerificationInput, VerificationResult } from "../types.ts";

export function do_recordFinal(self: TaskVerificationController, input: VerificationInput): VerificationResult {
  if (!self.state.taskKind || !self.state.taskSummary || self.state.mutationRevision === 0) {
    return self.rejected("Final verification requires a declared task and at least one production mutation.");
  }
  const evidence = self.resolveFinalEvidence(input.evidence_refs, input.final_status === "failed");
  if (typeof evidence === "string") return self.rejected(evidence);
  const finalMethod = isFinalMethod(input.final_method) ? input.final_method : self.finalMethodForEvidence(evidence);
  const finalStatus =
    input.final_status === "passed" || input.final_status === "failed"
      ? input.final_status
      : evidence.some((item) => item.isError)
        ? "failed"
        : "passed";
  const expectedBehavior = normalizeText(input.expected_behavior) || self.state.taskSummary;
  const observedBehavior =
    normalizeText(input.observed_behavior) ||
    evidence
      .map((item) => `${item.descriptor}: ${item.outputSummary || (item.isError ? "failed" : "passed")}`)
      .join("; ");
  const unresolvedFailures = normalizeStrings(input.unresolved_failures);
  if (evidence.some((item) => item.mutationRevision !== self.state.mutationRevision)) {
    return self.rejected(
      `Final evidence is stale; all handles must come from mutation revision ${self.state.mutationRevision}.`,
    );
  }

  if (finalStatus === "failed") {
    self.state = {
      ...self.state,
      final: {
        status: "failed",
        expectedBehavior,
        observedBehavior,
        method: finalMethod,
        evidenceRefs: evidence.map((item) => item.ref),
        unresolvedFailures,
        verifiedMutationRevision: self.state.mutationRevision,
      },
      readiness: emptyReadiness(),
      updatedAt: new Date().toISOString(),
    };
    self.persistState();
    return self.updated("Final verification recorded as failed; successful completion remains blocked.");
  }
  if (unresolvedFailures.length > 0 || evidence.some((item) => item.isError)) {
    return self.rejected("Passed final verification cannot contain unresolved failures or failed evidence.");
  }

  const taskText = `${self.state.taskContext ?? self.latestUserPrompt}\n${self.state.taskSummary}`;
  const behavioral = behavioralFinalRequired(self.state.taskKind, taskText);
  if (
    finalMethod === "static_review" &&
    (behavioral || evidence.filter((item) => isStaticTool(item.toolName)).length < 2)
  ) {
    return self.rejected(
      "static_review cannot prove behavioral code changes and otherwise requires two inspection handles.",
    );
  }
  if (
    finalMethod === "focused_test" &&
    evidence.some(
      (item) => isShellTool(item.toolName) && TEST_PATTERN.test(item.descriptor) && /\s*\|\s*/.test(item.descriptor),
    )
  ) {
    return self.rejected(
      "Pipelined test commands (containing '|') mask exit codes and cannot be used for test verification evidence. Rerun the test command directly without piping.",
    );
  }
  if (
    finalMethod === "focused_test" &&
    !evidence.some(
      (item) =>
        isShellTool(item.toolName) && TEST_PATTERN.test(item.descriptor) && FOCUSED_TEST_PATTERN.test(item.descriptor),
    )
  ) {
    return self.rejected("focused_test requires evidence from a specific test file or test name.");
  }
  if (
    finalMethod === "test_suite" &&
    (behavioral ||
      HIGH_RISK_PATTERN.test(taskText) ||
      !evidence.some((item) => isShellTool(item.toolName) && TEST_PATTERN.test(item.descriptor)))
  ) {
    return self.rejected("A broad test suite alone is insufficient for self behavioral task.");
  }
  if (
    finalMethod === "manual_reproduction" &&
    !evidence.some(
      (item) =>
        isShellTool(item.toolName) &&
        !GENERIC_CHECK_PATTERN.test(item.descriptor) &&
        !READ_ONLY_PATTERN.test(item.descriptor),
    )
  ) {
    return self.rejected("manual_reproduction requires non-generic bash evidence exercising the changed behavior.");
  }

  const baselineEvidence = self.state.baseline.evidenceRefs
    .map((ref) => self.evidence.get(ref))
    .filter((item): item is TaskVerificationEvidence => item !== undefined);
  if (self.state.baseline.method === "runtime_reproduction") {
    const baselineCommands = new Set(
      baselineEvidence.filter((item) => isShellTool(item.toolName) && !item.isError).map((item) => item.descriptor),
    );
    if (!evidence.some((item) => isShellTool(item.toolName) && baselineCommands.has(item.descriptor))) {
      return self.rejected("Final verification must rerun the same command that established the runtime baseline.");
    }
  }
  if (self.state.baseline.method === "failing_regression_test") {
    const baselineTests = new Set(
      baselineEvidence
        .filter((item) => isShellTool(item.toolName) && item.isError && TEST_PATTERN.test(item.descriptor))
        .map((item) => item.descriptor),
    );
    if (!evidence.some((item) => isShellTool(item.toolName) && baselineTests.has(item.descriptor))) {
      return self.rejected("Final verification must rerun the same focused test that failed at baseline.");
    }
  }

  self.state = {
    ...self.state,
    final: {
      status: "passed",
      expectedBehavior,
      observedBehavior,
      method: finalMethod,
      evidenceRefs: evidence.map((item) => item.ref),
      unresolvedFailures: [],
      verifiedMutationRevision: self.state.mutationRevision,
    },
    readiness: emptyReadiness(),
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  if (isCodeTask(self.state.taskKind)) {
    return self.updated(
      "Final semantic verification passed for the current mutation revision.\n\n" +
        `NEXT REQUIRED ACTION: call ${TASK_VERIFICATION_TOOL_NAME} with action "ready_to_finish" to review all user requirements and obtain a verification_token before calling finish_work.`,
    );
  }
  return self.updated("Final semantic verification passed for the current mutation revision.");
}
