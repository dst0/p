import type { BeforeToolCallResult } from "@dst0/p-agent-core";
import {
  FOCUSED_TEST_PATTERN,
  GENERIC_CHECK_PATTERN,
  HIGH_RISK_PATTERN,
  READ_ONLY_PATTERN,
  TASK_VERIFICATION_TOOL_NAME,
  TEST_PATTERN,
} from "../constants.ts";
import { behavioralFinalRequired } from "../requirement-checks.ts";
import { emptyReadiness } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { isShellTool, isStaticTool } from "../tool-classification.ts";
import type { FinalMethod, TaskVerificationEvidence, VerificationResult } from "../types.ts";

export function do_requiredBaselineReplayDescriptor(self: TaskVerificationController): string | undefined {
  if (self.state.baseline.method === "runtime_reproduction") {
    return self.state.baseline.evidenceRefs
      .map((ref) => self.evidence.get(ref))
      .find((item) => item && isShellTool(item.toolName) && !item.isError)?.descriptor;
  }
  if (self.state.baseline.method === "failing_regression_test") {
    return self.state.baseline.evidenceRefs
      .map((ref) => self.evidence.get(ref))
      .find((item) => item && isShellTool(item.toolName) && item.isError && TEST_PATTERN.test(item.descriptor))
      ?.descriptor;
  }
  return undefined;
}

export function do_tryAutoFinalizeExactReplay(
  self: TaskVerificationController,
  evidence: TaskVerificationEvidence,
): string | undefined {
  if (
    evidence.isError ||
    evidence.mutationRevision === 0 ||
    !self.state.taskKind ||
    !self.state.taskSummary ||
    self.state.baseline.status !== "satisfied" ||
    evidence.descriptor !== self.requiredBaselineReplayDescriptor()
  ) {
    return undefined;
  }

  if (
    self.state.final.status === "passed" &&
    self.state.final.verifiedMutationRevision === self.state.mutationRevision &&
    self.state.readiness?.status !== "pending"
  ) {
    return "Additional exact baseline replay evidence was recorded; the active requirement audit remains valid.";
  }

  self.state = {
    ...self.state,
    final: {
      status: "passed",
      expectedBehavior: self.state.taskSummary,
      observedBehavior: `${evidence.descriptor}: ${evidence.outputSummary || "passed"}`,
      method: self.state.baseline.method === "failing_regression_test" ? "focused_test" : "manual_reproduction",
      evidenceRefs: [evidence.ref],
      unresolvedFailures: [],
      verifiedMutationRevision: self.state.mutationRevision,
    },
    readiness: emptyReadiness(),
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  return "Exact baseline replay passed and final verification was recorded automatically. Complete ready_to_finish before finish_work.";
}

export function do_tryAutoFinalizeFocusedTest(
  self: TaskVerificationController,
  evidence: TaskVerificationEvidence,
): string | undefined {
  if (
    evidence.isError ||
    evidence.mutationRevision === 0 ||
    !self.state.taskKind ||
    !self.state.taskSummary ||
    self.state.baseline.status === "pending" ||
    !isShellTool(evidence.toolName) ||
    !TEST_PATTERN.test(evidence.descriptor) ||
    !FOCUSED_TEST_PATTERN.test(evidence.descriptor) ||
    /\s*\|\s*/u.test(evidence.descriptor)
  ) {
    return undefined;
  }

  if (
    self.state.final.status === "passed" &&
    self.state.final.verifiedMutationRevision === self.state.mutationRevision &&
    self.state.readiness?.status !== "pending"
  ) {
    return "Additional focused semantic evidence was recorded; the active requirement audit remains valid.";
  }

  const result = self.recordFinal({
    action: "record_final",
    final_method: "focused_test",
    final_status: "passed",
    evidence_refs: [evidence.ref],
    unresolved_failures: [],
  });
  if (result.status !== "updated" || self.state.final.status !== "passed") return undefined;
  return "Focused semantic verification passed and final verification was recorded automatically. Complete ready_to_finish before finish_work.";
}

export function do_highRiskAcceptanceAudit(
  self: TaskVerificationController,
  evidence: TaskVerificationEvidence,
): string | undefined {
  if (
    evidence.isError ||
    evidence.mutationRevision === 0 ||
    !self.state.taskKind ||
    !self.state.taskSummary ||
    !isShellTool(evidence.toolName) ||
    !TEST_PATTERN.test(evidence.descriptor) ||
    FOCUSED_TEST_PATTERN.test(evidence.descriptor)
  ) {
    return undefined;
  }
  const taskText = self.taskText();
  if (!HIGH_RISK_PATTERN.test(taskText)) return undefined;
  return [
    "HIGH-RISK ACCEPTANCE AUDIT REQUIRED before completion: a broad suite passed, but it does not prove every explicit guarantee.",
    "Re-read the original task and run focused adversarial tests for each absolute or negative requirement.",
    "Preserve exact public API return shapes without invented wrappers; use lossless identities containing every relevant input and option.",
    "Test the literal smallest boundary mutation (for a newline-terminated serialization, remove exactly one final byte rather than a whole line or record).",
    "After failed atomic operations, retry every attempted identity with both identical and changed payloads to prove complete rollback.",
    "A successful focused test command records final verification, but ready_to_finish still requires explicit requirement-to-evidence mappings.",
  ].join("\n");
}

export function do_findEligibleFinalEvidence(self: TaskVerificationController): TaskVerificationEvidence[] | undefined {
  const current = [...self.evidence.values()].filter(
    (item) => item.mutationRevision === self.state.mutationRevision && !item.isError,
  );
  const newestFirst = current.slice().reverse();
  const focusedTest = newestFirst.find(
    (item) =>
      isShellTool(item.toolName) &&
      TEST_PATTERN.test(item.descriptor) &&
      FOCUSED_TEST_PATTERN.test(item.descriptor) &&
      !/\s*\|\s*/.test(item.descriptor),
  );
  if (focusedTest) return [focusedTest];

  const manualReproduction = newestFirst.find(
    (item) =>
      isShellTool(item.toolName) &&
      !TEST_PATTERN.test(item.descriptor) &&
      !GENERIC_CHECK_PATTERN.test(item.descriptor) &&
      !READ_ONLY_PATTERN.test(item.descriptor),
  );
  if (manualReproduction) return [manualReproduction];

  const taskText = self.taskText();
  const behavioral = self.state.taskKind ? behavioralFinalRequired(self.state.taskKind, taskText) : true;
  const highRisk = HIGH_RISK_PATTERN.test(taskText);
  if (!behavioral && !highRisk) {
    const testSuite = newestFirst.find((item) => isShellTool(item.toolName) && TEST_PATTERN.test(item.descriptor));
    if (testSuite) return [testSuite];
  }

  if (!behavioral) {
    const staticEvidence = current.filter((item) => isStaticTool(item.toolName));
    if (staticEvidence.length >= 2) return staticEvidence.slice(-2);
  }
  return undefined;
}

export function do_finalMethodForEvidence(
  _self: TaskVerificationController,
  evidence: readonly TaskVerificationEvidence[],
): FinalMethod {
  if (evidence.length >= 2 && evidence.every((item) => isStaticTool(item.toolName))) {
    return "static_review";
  }
  const primary = evidence[0];
  if (!primary) return "manual_reproduction";
  if (
    isShellTool(primary.toolName) &&
    TEST_PATTERN.test(primary.descriptor) &&
    FOCUSED_TEST_PATTERN.test(primary.descriptor)
  ) {
    return "focused_test";
  }
  if (isShellTool(primary.toolName) && TEST_PATTERN.test(primary.descriptor)) return "test_suite";
  return "manual_reproduction";
}

export function do_formatFinalRecordGuidance(
  self: TaskVerificationController,
  evidence: readonly TaskVerificationEvidence[],
  method: FinalMethod = self.finalMethodForEvidence(evidence),
): string {
  const refs = evidence.map((item) => item.ref);
  const evidenceLines = evidence.map((item) => `- ${item.ref}: ${item.descriptor}`);
  const payload = JSON.stringify({
    action: "record_final",
    final_method: method,
    final_status: "passed",
    expected_behavior: "the behavior that must now hold",
    observed_behavior: "what this evidence demonstrated",
    evidence_refs: refs,
    unresolved_failures: [],
  });
  return [
    "NEXT REQUIRED ACTION: record final verification using the successful semantic evidence already collected for the current mutation revision.",
    `Eligible evidence:\n${evidenceLines.join("\n")}`,
    `Use evidence_refs: ${JSON.stringify(refs)}`,
    `Call ${TASK_VERIFICATION_TOOL_NAME} with:`,
    payload,
  ].join("\n");
}

export function do_findEvidence(
  self: TaskVerificationController,
  predicate: (evidence: TaskVerificationEvidence) => boolean,
): TaskVerificationEvidence | undefined {
  return [...self.evidence.values()].reverse().find(predicate);
}

export function do_withGuidance(self: TaskVerificationController, message: string): string {
  return `${message}\n\n${self.formatNextRequirement()}\n\nTo inspect the complete durable verification state at any time, call ${TASK_VERIFICATION_TOOL_NAME} with {"action":"status"}.`;
}

export function do_blocked(self: TaskVerificationController, message: string): BeforeToolCallResult {
  return { block: true, reason: self.withGuidance(message) };
}

export function do_updated(
  self: TaskVerificationController,
  message: string,
  includeGuidance: boolean = true,
): VerificationResult {
  return {
    status: "updated",
    message: includeGuidance ? `${message}\n\n${self.formatNextRequirement()}` : message,
    state: self.currentState,
  };
}

export function do_rejected(self: TaskVerificationController, message: string): VerificationResult {
  return { status: "needs_action", message, state: self.currentState };
}
