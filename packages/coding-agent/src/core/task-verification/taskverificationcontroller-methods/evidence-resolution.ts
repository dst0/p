import type { BeforeToolCallResult } from "@dst0/p-agent-core";
import {
  GENERIC_CHECK_PATTERN,
  REQUIREMENT_AUDIT_TOOL_NAME,
  TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE,
  TASK_VERIFICATION_STATE_CUSTOM_TYPE,
  TASK_VERIFICATION_TOOL_NAME,
  TEST_PATTERN,
} from "../constants.ts";
import {
  computeCertificateHash,
  computeRequirementSetHash,
  computeUserRequirementsHash,
  sourcePromptsForState,
} from "../requirement-audit-hashing.ts";
import { emptyReadiness, emptyRequirementAudit } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import {
  isShellTool,
  isTaskVerificationEvidence,
  isTaskVerificationState,
  normalizeStrings,
} from "../tool-classification.ts";
import type { TaskVerificationEvidence } from "../types.ts";

export function do_resolveEvidence(
  self: TaskVerificationController,
  refs: readonly string[] | undefined,
): TaskVerificationEvidence[] | string {
  const normalizedRefs = normalizeStrings(refs);
  if (normalizedRefs.length === 0) return "At least one evidence_refs handle is required.";
  const missingRefs: string[] = [];
  const resolved: TaskVerificationEvidence[] = [];

  for (const ref of normalizedRefs) {
    const cleanedRef = ref.replace(/^@/u, "").trim();
    let found = self.evidence.get(ref);
    if (!found) found = self.evidence.get(cleanedRef);
    if (!found) {
      found = [...self.evidence.values()].find((e) => e.toolCallId === ref || e.toolCallId === cleanedRef);
    }
    if (found) {
      resolved.push(found);
    } else {
      missingRefs.push(ref);
    }
  }

  if (missingRefs.length > 0) {
    const available = [...self.evidence.values()]
      .slice(-8)
      .map((e) => `${e.ref} (@${e.toolCallId})`)
      .join(", ");
    return `Unknown evidence handle(s): ${missingRefs.join(", ")}.${available ? ` Available handles: ${available}` : ""}`;
  }
  return resolved;
}

export function do_taskText(self: TaskVerificationController): string {
  const promptText = sourcePromptsForState(self.state)
    .map((prompt) => prompt.text)
    .join("\n");
  return `${promptText || self.state.taskContext || self.latestUserPrompt}\n${self.state.taskSummary ?? ""}`;
}

export function do_latestFailedVerificationEvidence(self: TaskVerificationController): TaskVerificationEvidence[] {
  const latestByCommand = new Map<string, TaskVerificationEvidence>();
  for (const item of self.evidence.values()) {
    if (
      item.mutationRevision === self.state.mutationRevision &&
      isShellTool(item.toolName) &&
      (TEST_PATTERN.test(item.descriptor) || GENERIC_CHECK_PATTERN.test(item.descriptor))
    ) {
      latestByCommand.set(item.descriptor, item);
    }
  }
  return [...latestByCommand.values()].filter((item) => item.isError);
}

export function do_finalVerificationError(self: TaskVerificationController, action: string): string | undefined {
  if (self.state.baseline.required && self.state.baseline.status !== "satisfied") {
    return `Cannot ${action}: baseline verification is incomplete.`;
  }
  if (
    self.state.final.status !== "passed" ||
    self.state.final.verifiedMutationRevision !== self.state.mutationRevision
  ) {
    return `Cannot ${action}: semantic verification has not passed after mutation revision ${self.state.mutationRevision}.`;
  }
  return undefined;
}

export function do_publishGate(self: TaskVerificationController, action: string): BeforeToolCallResult | undefined {
  if (self.state.mutationRevision === 0) return undefined;
  const finalError = self.finalVerificationError(action);
  if (finalError) return self.blocked(finalError);
  const failedVerifications = self.latestFailedVerificationEvidence();
  if (failedVerifications.length > 0) {
    return self.blocked(
      `Cannot ${action}: rerun the latest failed verification successfully first (${failedVerifications
        .map((item) => item.descriptor)
        .join(", ")}).`,
    );
  }
  const readiness = self.state.readiness ?? emptyReadiness();
  const currentRequirementsHash = computeUserRequirementsHash(sourcePromptsForState(self.state));
  if (
    (readiness.status !== "evidence_ready" && readiness.status !== "completion_ready") ||
    readiness.verifiedMutationRevision !== self.state.mutationRevision ||
    readiness.userRequirementsHash !== currentRequirementsHash
  ) {
    return self.blocked(
      `Cannot ${action}: call ${TASK_VERIFICATION_TOOL_NAME} with action "ready_to_finish" and map every explicit acceptance criterion to fresh evidence first.`,
    );
  }
  return undefined;
}

export function do_completionGate(
  self: TaskVerificationController,
  action: string,
  verificationToken?: string,
): BeforeToolCallResult | undefined {
  const publishError = do_publishGate(self, action);
  if (publishError || self.state.mutationRevision === 0) return publishError;

  const readiness = self.state.readiness ?? emptyReadiness();
  const audit = self.state.requirementAudit;
  const currentRequirementsHash = computeUserRequirementsHash(sourcePromptsForState(self.state));
  const currentRequirementSetHash = computeRequirementSetHash(audit.requirements, audit.ignoredSourcePrompts);
  const expectedCertificateHash = computeCertificateHash(
    self.state.taskId,
    self.state.mutationRevision,
    currentRequirementsHash,
    currentRequirementSetHash,
  );
  const allVerdictsPass =
    audit.requirements.length > 0 &&
    audit.requirements.every((requirement) => {
      if (
        requirement.verdict?.passed !== true ||
        requirement.verdict.mutationRevision !== self.state.mutationRevision
      ) {
        return false;
      }
      const evidence = self.resolveEvidence(requirement.verdict.evidenceRefs);
      return (
        typeof evidence !== "string" &&
        evidence.every((item) => !item.isError && item.mutationRevision === self.state.mutationRevision)
      );
    });
  if (
    readiness.status !== "completion_ready" ||
    audit.status !== "passed" ||
    !allVerdictsPass ||
    audit.verifiedMutationRevision !== self.state.mutationRevision ||
    readiness.requirementSetHash !== currentRequirementSetHash ||
    readiness.certificateHash !== expectedCertificateHash ||
    !readiness.token
  ) {
    return self.blocked(
      `Cannot ${action}: complete every sequential verdict through ${REQUIREMENT_AUDIT_TOOL_NAME} before finish_work.`,
    );
  }
  if (verificationToken !== readiness.token) {
    return self.blocked(
      `Cannot ${action}: pass the exact verification_token returned after the requirement audit for mutation revision ${self.state.mutationRevision}.`,
    );
  }
  return undefined;
}

export function do_restore(self: TaskVerificationController): void {
  const restoredEvidence: TaskVerificationEvidence[] = [];
  for (const entry of self.sessionManager.getBranch()) {
    if (entry.type !== "custom") continue;
    if (entry.customType === TASK_VERIFICATION_STATE_CUSTOM_TYPE && isTaskVerificationState(entry.data)) {
      self.state = {
        ...entry.data,
        taskPrompts: entry.data.taskPrompts ?? [],
        readiness: entry.data.readiness ?? emptyReadiness(),
        requirementAudit: entry.data.requirementAudit ?? emptyRequirementAudit(),
      };
    }
    if (entry.customType === TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE && isTaskVerificationEvidence(entry.data)) {
      restoredEvidence.push(entry.data);
      const numericRef = Number.parseInt(entry.data.ref.replace(/^verification-evidence-/, ""), 10);
      if (Number.isFinite(numericRef)) self.nextEvidence = Math.max(self.nextEvidence, numericRef + 1);
    }
  }
  for (const evidence of restoredEvidence) {
    if (evidence.taskId === self.state.taskId) self.evidence.set(evidence.ref, evidence);
  }
}

export function do_persistState(self: TaskVerificationController): void {
  self.sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, self.state);
}

export function do_formatStatus(self: TaskVerificationController): string {
  const recentEvidence = [...self.evidence.values()]
    .slice(-8)
    .map(
      (item) =>
        `${item.ref} (@${item.toolCallId}): ${item.isError ? "FAILED" : "passed"} ${item.toolName} at revision ${item.mutationRevision} — ${item.descriptor}${item.outputSummary ? ` — ${item.outputSummary}` : ""}`,
    );
  return [
    `Task: ${self.state.taskKind ?? "undeclared"}${self.state.taskSummary ? ` — ${self.state.taskSummary}` : ""}`,
    `Mutation revision: ${self.state.mutationRevision}`,
    `Baseline: ${self.state.baseline.status}`,
    `Authorized baseline tests: ${self.state.baseline.authorizedTestPaths.join(", ") || "none"}`,
    `Final: ${self.state.final.status}`,
    `Readiness: ${(self.state.readiness ?? emptyReadiness()).status}`,
    `Requirement audit: ${self.state.requirementAudit.status}`,
    self.state.final.unresolvedFailures.length > 0
      ? `Unresolved failures: ${self.state.final.unresolvedFailures.join("; ")}`
      : undefined,
    recentEvidence.length > 0 ? `Evidence:\n- ${recentEvidence.join("\n- ")}` : "Evidence: none",
    self.formatNextRequirement(),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}
