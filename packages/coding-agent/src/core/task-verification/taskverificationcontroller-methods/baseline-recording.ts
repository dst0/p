import { FOCUSED_TEST_PATTERN, GENERIC_CHECK_PATTERN, HIGH_RISK_PATTERN, READ_ONLY_PATTERN } from "../constants.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import {
  isBaselineMethod,
  isShellTool,
  isStaticTool,
  normalizeStrings,
  normalizeText,
} from "../tool-classification.ts";
import type { VerificationInput, VerificationResult } from "../types.ts";
import { commandContainsTestInvocation } from "./test-command-invocation.ts";

export function do_recordBaseline(self: TaskVerificationController, input: VerificationInput): VerificationResult {
  if (!self.state.taskKind || !self.state.taskSummary) {
    return self.rejected("Declare the task before baseline verification.");
  }
  if (
    !isBaselineMethod(input.baseline_method) ||
    !normalizeText(input.hypothesis) ||
    !normalizeText(input.conclusion)
  ) {
    return self.rejected("record_baseline requires baseline_method, hypothesis, and conclusion.");
  }
  if (normalizeStrings(input.unresolved_assumptions).length > 0) {
    return self.rejected("Baseline verification cannot pass with unresolved assumptions.");
  }
  const evidence = self.resolveEvidence(input.evidence_refs);
  if (typeof evidence === "string") return self.rejected(evidence);
  if (evidence.some((item) => item.mutationRevision !== 0)) {
    return self.rejected("Baseline evidence must come from mutation revision 0.");
  }

  const taskText = `${self.state.taskContext ?? self.latestUserPrompt}\n${self.state.taskSummary}`;
  if (input.baseline_method === "static_trace") {
    if (HIGH_RISK_PATTERN.test(taskText)) {
      return self.rejected(
        "Static trace is insufficient for signal/restart/persistence/recovery/concurrency/indexing work.",
      );
    }
    if (evidence.filter((item) => !item.isError && isStaticTool(item.toolName)).length < 2) {
      return self.rejected("static_trace requires two non-error inspection evidence handles.");
    }
  }
  if (
    input.baseline_method === "runtime_reproduction" &&
    !evidence.some(
      (item) =>
        isShellTool(item.toolName) &&
        !item.isError &&
        !GENERIC_CHECK_PATTERN.test(item.descriptor) &&
        !READ_ONLY_PATTERN.test(item.descriptor),
    )
  ) {
    return self.rejected("runtime_reproduction requires successful non-generic bash evidence exercising the behavior.");
  }
  if (input.baseline_method === "failing_regression_test") {
    if (self.state.baseline.authorizedTestPaths.length > 0 && !self.state.baseline.testSetupChanged) {
      return self.rejected("The authorized regression test was not created or modified before running it.");
    }
    if (
      evidence.some(
        (item) =>
          isShellTool(item.toolName) &&
          commandContainsTestInvocation(item.descriptor) &&
          /\s*\|\s*/.test(item.descriptor),
      )
    ) {
      return self.rejected(
        "Pipelined test commands (containing '|') mask exit codes and cannot be used for test verification evidence. Rerun the test command directly without piping.",
      );
    }
    if (
      !evidence.some(
        (item) =>
          isShellTool(item.toolName) &&
          item.isError &&
          (item.nativeIsError ?? item.isError) &&
          commandContainsTestInvocation(item.descriptor) &&
          FOCUSED_TEST_PATTERN.test(item.descriptor),
      )
    ) {
      return self.rejected("failing_regression_test requires a native failing focused-test evidence handle.");
    }
  }

  self.state = {
    ...self.state,
    baseline: {
      ...self.state.baseline,
      status: "satisfied",
      hypothesis: normalizeText(input.hypothesis),
      conclusion: normalizeText(input.conclusion),
      method: input.baseline_method,
      evidenceRefs: evidence.map((item) => item.ref),
    },
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  return self.updated("Baseline verification recorded; production mutation is unblocked.");
}
