import { resolve } from "node:path";
import { TEST_PATTERN, TYPECHECK_PATTERN } from "../constants.ts";
import {
  computeRequirementSetHash,
  computeUserRequirementsHash,
  sourcePromptsForState,
} from "../requirement-audit-hashing.ts";
import { requiredAcceptanceCheckCount, testsRequested, typecheckRequested } from "../requirement-checks.ts";
import { formatRequirementDefinitionPrompt } from "../requirement-definition-prompt.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import {
  findOversizedSourceFiles,
  isDirectMutationTool,
  isShellTool,
  normalizeStrings,
  normalizeText,
  pathArgument,
} from "../tool-classification.ts";
import type {
  TaskVerificationAcceptanceCheck,
  TaskVerificationEvidence,
  VerificationInput,
  VerificationResult,
} from "../types.ts";
import { formatRequirementPrompt } from "./requirement-audit.ts";

export function do_readyToFinish(self: TaskVerificationController, input: VerificationInput): VerificationResult {
  if (!self.state.taskSummary || self.state.mutationRevision === 0) {
    return self.rejected("ready_to_finish requires a declared code task and at least one production mutation.");
  }
  const finalError = self.finalVerificationError("prepare successful completion");
  if (finalError) return self.rejected(finalError);

  const unresolvedFailures = normalizeStrings(input.unresolved_failures);
  if (unresolvedFailures.length > 0) {
    return self.rejected("ready_to_finish cannot pass with unresolved_failures.");
  }

  const requestedChecks = input.acceptance_checks ?? [];
  const requiredCheckCount = requiredAcceptanceCheckCount(self.taskText());
  if (requestedChecks.length < requiredCheckCount) {
    return self.rejected(
      `ready_to_finish requires at least ${requiredCheckCount} distinct acceptance_checks for the explicit guarantees in this task; received ${requestedChecks.length}.`,
    );
  }

  const acceptanceChecks: TaskVerificationAcceptanceCheck[] = [];
  const seenCriteria = new Set<string>();
  const mappedEvidence = new Map<string, TaskVerificationEvidence>();
  for (const requestedCheck of requestedChecks) {
    const criterion = normalizeText(requestedCheck.criterion);
    if (!criterion) return self.rejected("Every acceptance check requires a concrete criterion.");
    const criterionKey = criterion.toLowerCase();
    if (seenCriteria.has(criterionKey)) {
      return self.rejected(`Duplicate acceptance criterion: ${criterion}`);
    }
    seenCriteria.add(criterionKey);

    const evidence = self.resolveEvidence(requestedCheck.evidence_refs);
    if (typeof evidence === "string") return self.rejected(`${criterion}: ${evidence}`);
    if (evidence.some((item) => item.mutationRevision !== self.state.mutationRevision)) {
      return self.rejected(
        `${criterion}: all readiness evidence must come from mutation revision ${self.state.mutationRevision}.`,
      );
    }
    if (evidence.some((item) => item.isError)) {
      return self.rejected(`${criterion}: failed evidence cannot prove readiness.`);
    }
    for (const item of evidence) mappedEvidence.set(item.ref, item);
    acceptanceChecks.push({ criterion, evidenceRefs: evidence.map((item) => item.ref) });
  }

  const failedVerifications = self.latestFailedVerificationEvidence();
  if (failedVerifications.length > 0) {
    return self.rejected(
      [
        "ready_to_finish is blocked by verification commands whose latest execution still failed:",
        ...failedVerifications.map((item) => `- ${item.descriptor}: ${item.outputSummary || "failed"}`),
        "Repair the implementation and rerun each exact command successfully.",
      ].join("\n"),
    );
  }

  const mappedValues = [...mappedEvidence.values()];
  const unmappedFinalEvidence = self.state.final.evidenceRefs.filter((ref) => !mappedEvidence.has(ref));
  if (unmappedFinalEvidence.length > 0) {
    return self.rejected(
      `Acceptance checks must include the final semantic verification evidence: ${unmappedFinalEvidence.join(", ")}.`,
    );
  }
  const taskText = self.taskText();
  if (
    testsRequested(taskText) &&
    !mappedValues.some((item) => isShellTool(item.toolName) && TEST_PATTERN.test(item.descriptor))
  ) {
    return self.rejected(
      "The task explicitly requires tests, but no successful current-revision test evidence is mapped to an acceptance check.",
    );
  }
  if (
    typecheckRequested(taskText) &&
    !mappedValues.some((item) => isShellTool(item.toolName) && TYPECHECK_PATTERN.test(item.descriptor))
  ) {
    return self.rejected(
      "The task explicitly requires type checking, but no successful current-revision typecheck evidence is mapped to an acceptance check.",
    );
  }

  const oversizedFiles = findOversizedSourceFiles(
    self.sessionManager.getCwd(),
    taskText,
    Array.from(self.mutatedSourceFiles),
    250,
  );
  if (oversizedFiles.length > 0) {
    const fileList = oversizedFiles.map((f) => `- ${f.path}: ${f.lineCount} lines (limit: 250)`).join("\n");
    return self.rejected(
      [
        "ready_to_finish is blocked because the following source code file(s) exceed the 250-line file size limit:",
        fileList,
        "Please refactor and split large source files into focused, modular components (recommended target ~150 lines per file) before finishing, unless the user explicitly requested a single large file or ignoring file size limits.",
      ].join("\n"),
    );
  }

  const transitionError = self.beginAuditTransition();
  if (transitionError) return self.rejected(transitionError);

  const sourcePrompts = sourcePromptsForState(self.state);
  const userRequirementsHash = computeUserRequirementsHash(sourcePrompts);
  const existingAudit = self.state.requirementAudit;
  const reuseRequirements =
    existingAudit.requirements.length > 0 && existingAudit.userRequirementsHash === userRequirementsHash;
  const requirements = reuseRequirements
    ? existingAudit.requirements.map((requirement) => ({
        id: requirement.id,
        type: requirement.type,
        text: requirement.text,
        acceptanceCriterion: requirement.acceptanceCriterion,
        sourcePromptIndexes: requirement.sourcePromptIndexes,
      }))
    : [];
  const ignoredSourcePrompts = reuseRequirements ? existingAudit.ignoredSourcePrompts : [];
  const requirementSetHash = reuseRequirements
    ? computeRequirementSetHash(requirements, ignoredSourcePrompts)
    : undefined;
  self.state = {
    ...self.state,
    readiness: {
      status: "evidence_ready",
      acceptanceChecks,
      verifiedMutationRevision: self.state.mutationRevision,
      userRequirementsHash,
      requirementSetHash,
    },
    requirementAudit: {
      status: reuseRequirements ? "verifying" : "awaiting_definition",
      requirements,
      ignoredSourcePrompts,
      nextRequirementIndex: 0,
      userRequirementsHash,
      requirementSetHash,
    },
    updatedAt: new Date().toISOString(),
  };
  self.persistState();

  const auditPrompt = reuseRequirements
    ? [
        `Reusing the existing ${requirements.length}-item requirement set because the user requirements hash is unchanged.`,
        "All prior verdicts were cleared. Re-verify every requirement for the current evidence state.",
        "",
        formatRequirementPrompt(requirements[0]!, 0, requirements.length),
      ].join("\n")
    : formatRequirementDefinitionPrompt(sourcePrompts);

  return self.updated(
    [
      `Evidence readiness passed for mutation revision ${self.state.mutationRevision}.`,
      "Finalization operations such as git commit/push are now allowed.",
      "No verification_token has been issued; finish_work remains blocked until the requirement audit passes.",
      "",
      auditPrompt,
    ].join("\n"),
    false,
  );
}

export function do_isAuthorizedBaselineTestMutation(
  self: TaskVerificationController,
  toolName: string,
  args: unknown,
): boolean {
  if (
    self.state.baseline.status !== "pending" ||
    self.state.baseline.authorizedTestPaths.length === 0 ||
    !isDirectMutationTool(toolName)
  ) {
    return false;
  }
  const filePath = pathArgument(args);
  if (!filePath) return false;
  const absolutePath = resolve(self.sessionManager.getCwd(), filePath);
  return self.state.baseline.authorizedTestPaths.some(
    (authorizedPath) => resolve(self.sessionManager.getCwd(), authorizedPath) === absolutePath,
  );
}

export function do_resolveFinalEvidence(
  self: TaskVerificationController,
  refs: readonly string[] | undefined,
  includeFailed: boolean = false,
): TaskVerificationEvidence[] | string {
  if (normalizeStrings(refs).length > 0) return self.resolveEvidence(refs);

  const replayDescriptor = self.requiredBaselineReplayDescriptor();
  if (replayDescriptor) {
    const replayEvidence = self.findEvidence(
      (item) =>
        item.mutationRevision === self.state.mutationRevision &&
        isShellTool(item.toolName) &&
        item.descriptor === replayDescriptor &&
        (includeFailed || !item.isError),
    );
    return replayEvidence
      ? [replayEvidence]
      : `No eligible current-revision evidence reruns the required exact baseline command: ${replayDescriptor}`;
  }

  const eligibleEvidence = self.findEligibleFinalEvidence();
  if (eligibleEvidence) return eligibleEvidence;
  if (includeFailed) {
    const failedEvidence = self.findEvidence(
      (item) => item.mutationRevision === self.state.mutationRevision && item.isError,
    );
    if (failedEvidence) return [failedEvidence];
  }
  return `No eligible semantic evidence exists for mutation revision ${self.state.mutationRevision}.`;
}
