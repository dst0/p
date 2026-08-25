import {
  FOCUSED_TEST_PATTERN,
  GENERIC_CHECK_PATTERN,
  HIGH_RISK_PATTERN,
  READ_ONLY_PATTERN,
  REQUIREMENT_AUDIT_TOOL_NAME,
  TASK_VERIFICATION_TOOL_NAME,
  TEST_PATTERN,
} from "../constants.ts";
import {
  referencedRequirementCandidates,
  requirementSourceSelectionMatches,
} from "../referenced-requirement-sources.ts";
import { sourcePromptsForState } from "../requirement-audit-hashing.ts";
import { requiredAcceptanceCheckCount, testsRequested, typecheckRequested } from "../requirement-checks.ts";
import { formatRequirementDefinitionPrompt } from "../requirement-definition-prompt.ts";
import { requirementDefinitionSources } from "../requirement-source-storage.ts";
import { emptyReadiness } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { isShellTool, isStaticTool } from "../tool-classification.ts";
import { formatRequirementBatchPrompt } from "./requirement-audit-prompt.ts";

export function do_formatNextRequirement(self: TaskVerificationController): string {
  if (!self.state.taskKind || !self.state.taskSummary) {
    return [
      "Task classification is pending.",
      "Continue with inspection or baseline checks; the controller will classify the task before the first mutation.",
      `Use ${TASK_VERIFICATION_TOOL_NAME} with action "declare_task" only to override that classification before mutation.`,
    ].join("\n");
  }

  const prompts = sourcePromptsForState(self.state);
  const sourceCandidates = referencedRequirementCandidates(prompts);
  if (sourceCandidates.length > 0) {
    const references = self.state.requirementSourceRefs ?? [];
    const ignored = self.state.ignoredRequirementSources ?? [];
    if (!requirementSourceSelectionMatches(prompts, references, ignored)) {
      return [
        "NEXT REQUIRED ACTION: freeze referenced task specifications before baseline setup or implementation.",
        `Candidates: ${sourceCandidates.map((candidate) => candidate.path).join(", ")}.`,
        `Call ${REQUIREMENT_AUDIT_TOOL_NAME} once with action "prepare_definition", 0-3 relevant selected_paths, and reasons for every ignored_paths item.`,
      ].join("\n");
    }
  }

  if (self.state.baseline.required && self.state.baseline.status !== "satisfied") {
    const failingEvidence = self.findEvidence(
      (item) =>
        item.mutationRevision === 0 &&
        isShellTool(item.toolName) &&
        item.isError &&
        TEST_PATTERN.test(item.descriptor) &&
        FOCUSED_TEST_PATTERN.test(item.descriptor) &&
        !/\s*\|\s*/.test(item.descriptor),
    );
    const runtimeEvidence = self.findEvidence(
      (item) =>
        item.mutationRevision === 0 &&
        isShellTool(item.toolName) &&
        !item.isError &&
        !GENERIC_CHECK_PATTERN.test(item.descriptor) &&
        !READ_ONLY_PATTERN.test(item.descriptor),
    );
    const staticEvidence = [...self.evidence.values()].filter(
      (item) => item.mutationRevision === 0 && !item.isError && isStaticTool(item.toolName),
    );

    if (failingEvidence) {
      return [
        "NEXT REQUIRED ACTION: record the already-observed failing focused regression test as the baseline.",
        `Exact baseline test command: ${failingEvidence.descriptor}`,
        `Use evidence_refs: ["${failingEvidence.ref}"]`,
        `Call ${TASK_VERIFICATION_TOOL_NAME} with:`,
        `{"action":"record_baseline","baseline_method":"failing_regression_test","hypothesis":"why the current implementation causes this failure","conclusion":"what the failed test proves","evidence_refs":["${failingEvidence.ref}"],"unresolved_assumptions":[]}`,
      ].join("\n");
    }

    if (runtimeEvidence) {
      return [
        "NEXT REQUIRED ACTION: record the already-observed runtime reproduction as the baseline.",
        `Exact reproduction command: ${runtimeEvidence.descriptor}`,
        `Use evidence_refs: ["${runtimeEvidence.ref}"]`,
        `Call ${TASK_VERIFICATION_TOOL_NAME} with:`,
        `{"action":"record_baseline","baseline_method":"runtime_reproduction","hypothesis":"causal explanation for the current behavior","conclusion":"what the reproduction proves","evidence_refs":["${runtimeEvidence.ref}"],"unresolved_assumptions":[]}`,
      ].join("\n");
    }

    const taskText = `${self.state.taskContext ?? self.latestUserPrompt}\n${self.state.taskSummary}`;
    const highRisk = HIGH_RISK_PATTERN.test(taskText);
    if (!highRisk && staticEvidence.length >= 2) {
      const refs = staticEvidence.slice(-2).map((item) => item.ref);
      return [
        "NEXT REQUIRED ACTION: record the collected static trace as the baseline.",
        `Use evidence_refs: ${JSON.stringify(refs)}`,
        `Call ${TASK_VERIFICATION_TOOL_NAME} with:`,
        `{"action":"record_baseline","baseline_method":"static_trace","hypothesis":"causal explanation supported by the inspected paths","conclusion":"what the two independent inspections prove","evidence_refs":${JSON.stringify(refs)},"unresolved_assumptions":[]}`,
      ].join("\n");
    }

    if (self.state.baseline.authorizedTestPaths.length > 0) {
      if (!self.state.baseline.testSetupChanged) {
        return [
          "NEXT REQUIRED ACTION: create or modify the authorized regression test before touching production code.",
          `Only these paths are currently writable: ${self.state.baseline.authorizedTestPaths.join(", ")}.`,
          "Then run a focused command targeting that exact test and confirm it fails for the intended behavioral reason.",
        ].join("\n");
      }
      return [
        "NEXT REQUIRED ACTION: run the authorized regression test in isolation and obtain a FAILED evidence handle.",
        `Authorized test paths: ${self.state.baseline.authorizedTestPaths.join(", ")}.`,
        "The command must target a specific test file or test name; a broad suite does not satisfy this baseline.",
        "Run the test command directly without piping (pipelined commands containing '|' are not accepted).",
        "After the failing run, call action status again to receive the exact record_baseline payload.",
      ].join("\n");
    }

    return [
      "NEXT REQUIRED ACTION: establish the pre-change behavior before production mutation.",
      highRisk
        ? "This lifecycle/durability task requires either a runtime reproduction or a failing focused regression test; static inspection is not accepted."
        : "Use a runtime reproduction, a failing focused regression test, or two independent static inspection handles.",
      `For a regression test, first call ${TASK_VERIFICATION_TOOL_NAME} with {"action":"authorize_baseline_test","test_paths":["exact/repository-relative.test.ts"]}.`,
      "For runtime reproduction, run the concrete scenario now; its bash result will receive an evidence handle. Then call action status again.",
    ].join("\n");
  }

  if (self.rejectedRequirementDefinitionDraft) {
    const sources = requirementDefinitionSources(self.state, self.requirementSourceTexts);
    return [
      `NEXT REQUIRED ACTION: continue the active rejected requirement definition through ${REQUIREMENT_AUDIT_TOOL_NAME}.`,
      typeof sources === "string"
        ? sources
        : formatRequirementDefinitionPrompt(sources, self.rejectedRequirementDefinitionDraft),
    ].join("\n");
  }

  if (self.state.mutationRevision === 0) {
    return [
      "NEXT REQUIRED ACTION: implement the production change; the baseline gate is satisfied.",
      self.baselineReplayInstruction(),
      "After the final production mutation, rerun the required behavior and call action status again before record_final.",
    ].join("\n");
  }

  if (
    self.state.final.status === "passed" &&
    self.state.final.verifiedMutationRevision === self.state.mutationRevision
  ) {
    const readiness = self.state.readiness ?? emptyReadiness();
    if (
      readiness.status === "completion_ready" &&
      readiness.verifiedMutationRevision === self.state.mutationRevision &&
      readiness.token
    ) {
      return [
        "NEXT REQUIRED ACTION: completion certificate is current; git commit/push are unblocked.",
        `Call finish_work with verification_token "${readiness.token}".`,
      ].join("\n");
    }
    if (readiness.status === "evidence_ready" && readiness.verifiedMutationRevision === self.state.mutationRevision) {
      const audit = self.state.requirementAudit;
      if (audit.status === "awaiting_definition") {
        const sources = requirementDefinitionSources(self.state, self.requirementSourceTexts);
        return [
          `NEXT REQUIRED ACTION: define atomic user requirements through ${REQUIREMENT_AUDIT_TOOL_NAME}.`,
          typeof sources === "string"
            ? sources
            : formatRequirementDefinitionPrompt(sources, self.rejectedRequirementDefinitionDraft),
        ].join("\n");
      }
      if (audit.status === "verifying") {
        return `NEXT REQUIRED ACTION:\n${formatRequirementBatchPrompt(audit.requirements)}`;
      }
      if (audit.status === "failed") {
        const failed = audit.requirements.filter((requirement) => requirement.verdict?.passed === false);
        return [
          `NEXT REQUIRED ACTION: complete all ${failed.length} failed user requirement(s).`,
          ...failed.map((requirement) => `${requirement.id}: ${requirement.text} — ${requirement.verdict?.reason}`),
          `Then call ${TASK_VERIFICATION_TOOL_NAME} with action "ready_to_finish" to re-run the complete verdict batch.`,
        ].join("\n");
      }
    }
    const requiredCheckCount = requiredAcceptanceCheckCount(self.taskText());
    const currentEvidence = [...self.evidence.values()]
      .filter((item) => item.mutationRevision === self.state.mutationRevision && !item.isError)
      .slice(-8)
      .map((item) => `${item.ref}: ${item.descriptor}`);
    return [
      `NEXT REQUIRED ACTION: call ${TASK_VERIFICATION_TOOL_NAME} with action "ready_to_finish".`,
      `Re-read the original request and provide at least ${requiredCheckCount} distinct acceptance_checks covering every explicit requirement, negative guarantee, and boundary condition.`,
      "Map every criterion to fresh current-revision evidence_refs and pass unresolved_failures: [].",
      testsRequested(self.taskText())
        ? "The original task requests tests, so acceptance evidence must include a successful test command."
        : undefined,
      typecheckRequested(self.taskText())
        ? "The original task requests type checking, so acceptance evidence must include a successful typecheck command."
        : undefined,
      currentEvidence.length > 0 ? `Fresh evidence:\n- ${currentEvidence.join("\n- ")}` : "Fresh evidence: none",
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n");
  }

  const replayDescriptor = self.requiredBaselineReplayDescriptor();
  if (replayDescriptor) {
    const replayEvidence = self.findEvidence(
      (item) =>
        item.mutationRevision === self.state.mutationRevision &&
        isShellTool(item.toolName) &&
        item.descriptor === replayDescriptor,
    );

    if (replayEvidence?.isError) {
      return [
        "NEXT REQUIRED ACTION: the required baseline replay still fails; repair the implementation before recording final success.",
        `Failed replay command: ${replayEvidence.descriptor}`,
        `Failed evidence: ${replayEvidence.ref} — ${replayEvidence.outputSummary || "no output summary"}`,
        "After the next production mutation, rerun the same command and call action status again.",
      ].join("\n");
    }

    if (!replayEvidence) {
      return [
        "NEXT REQUIRED ACTION: rerun the exact scenario that established the baseline.",
        `Required exact replay command: ${replayDescriptor}`,
        `Only evidence from mutation revision ${self.state.mutationRevision} is eligible.`,
        "Do not substitute another focused test, broad suite, lint, or typecheck for this replay.",
        "Run the command directly without piping.",
        "After the successful replay, call action status again to receive the exact record_final payload.",
      ].join("\n");
    }

    return self.formatFinalRecordGuidance(
      [replayEvidence],
      self.state.baseline.method === "failing_regression_test" ? "focused_test" : "manual_reproduction",
    );
  }

  const eligibleEvidence = self.findEligibleFinalEvidence();
  if (eligibleEvidence) return self.formatFinalRecordGuidance(eligibleEvidence);

  return [
    "NEXT REQUIRED ACTION: collect fresh semantic evidence for the current mutation revision before completion.",
    self.baselineReplayInstruction(),
    `Only evidence from mutation revision ${self.state.mutationRevision} is eligible.`,
    "After the successful run, call action status again to receive the exact record_final payload and evidence handle.",
  ].join("\n");
}

export function do_baselineReplayInstruction(self: TaskVerificationController): string {
  const descriptor = self.requiredBaselineReplayDescriptor();
  if (!descriptor)
    return "Run a focused behavior-specific test or manual reproduction; generic lint/typecheck output is not sufficient.";
  return `Required exact replay command: ${descriptor}`;
}
