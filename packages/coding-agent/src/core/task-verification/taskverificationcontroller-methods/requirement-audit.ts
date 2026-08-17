import { randomUUID } from "node:crypto";
import { MAX_REQUIREMENT_COUNT, REQUIREMENT_AUDIT_TOOL_NAME, REQUIREMENT_TYPES } from "../constants.ts";
import {
  computeCertificateHash,
  computeRequirementSetHash,
  computeUserRequirementsHash,
  sourcePromptsForState,
} from "../requirement-audit-hashing.ts";
import { emptyReadiness } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { normalizeStrings, normalizeText } from "../tool-classification.ts";
import type { IgnoredSourcePrompt, RequirementAuditInput, TaskRequirement, VerificationResult } from "../types.ts";

function auditContextError(self: TaskVerificationController): string | undefined {
  const readiness = self.state.readiness ?? emptyReadiness();
  if (readiness.status !== "evidence_ready" || readiness.verifiedMutationRevision !== self.state.mutationRevision) {
    return 'Requirement audit is not active. Complete record_task_verification(action: "ready_to_finish") first.';
  }
  const currentHash = computeUserRequirementsHash(sourcePromptsForState(self.state));
  if (!readiness.userRequirementsHash || readiness.userRequirementsHash !== currentHash) {
    return "The accumulated user requirements changed. Call ready_to_finish again before continuing the audit.";
  }
  return undefined;
}

export function do_beginAuditTransition(self: TaskVerificationController): string | undefined {
  if (self.modelTurn === 0) return undefined;
  if (self.lastAuditTransitionTurn === self.modelTurn) {
    return "Only one requirement-audit transition is allowed per model turn. Read the latest tool result before the next transition.";
  }
  self.lastAuditTransitionTurn = self.modelTurn;
  return undefined;
}

export function do_applyRequirementAudit(
  self: TaskVerificationController,
  input: RequirementAuditInput,
): VerificationResult {
  const transitionError = self.beginAuditTransition();
  if (transitionError) return self.rejected(transitionError);
  if (input.action === "define") return do_defineRequirements(self, input);
  return do_recordRequirementVerdict(self, input);
}

function do_defineRequirements(self: TaskVerificationController, input: RequirementAuditInput): VerificationResult {
  const contextError = auditContextError(self);
  if (contextError) return self.rejected(contextError);
  if (self.state.requirementAudit.status !== "awaiting_definition") {
    return self.rejected("Requirement definitions are already fixed for this user-requirements hash.");
  }

  const prompts = sourcePromptsForState(self.state);
  const requested = input.requirements ?? [];
  if (requested.length === 0) return self.rejected("define requires at least one atomic requirement.");
  if (requested.length > MAX_REQUIREMENT_COUNT) {
    return self.rejected(`define supports at most ${MAX_REQUIREMENT_COUNT} atomic requirements.`);
  }

  const requirements: TaskRequirement[] = [];
  const coveredPromptIndexes = new Set<number>();
  const seenRequirements = new Set<string>();
  for (const [index, item] of requested.entries()) {
    if (!(REQUIREMENT_TYPES as readonly string[]).includes(item.type)) {
      return self.rejected(`Requirement ${index + 1} has an unsupported type.`);
    }
    const text = normalizeText(item.text);
    const acceptanceCriterion = normalizeText(item.acceptance_criterion);
    if (!text || !acceptanceCriterion) {
      return self.rejected(`Requirement ${index + 1} needs concrete text and acceptance_criterion.`);
    }
    const duplicateKey = `${item.type}\n${text.toLowerCase()}\n${acceptanceCriterion.toLowerCase()}`;
    if (seenRequirements.has(duplicateKey)) return self.rejected(`Duplicate requirement: ${text}`);
    seenRequirements.add(duplicateKey);

    const sourcePromptIndexes = [...new Set(item.source_prompt_indexes)].sort((left, right) => left - right);
    if (
      sourcePromptIndexes.length === 0 ||
      sourcePromptIndexes.some(
        (promptIndex) => !Number.isInteger(promptIndex) || promptIndex < 1 || promptIndex > prompts.length,
      )
    ) {
      return self.rejected(`Requirement ${index + 1} references an invalid source_prompt_index.`);
    }
    for (const promptIndex of sourcePromptIndexes) coveredPromptIndexes.add(promptIndex);
    requirements.push({
      id: `R${index + 1}`,
      type: item.type,
      text,
      acceptanceCriterion,
      sourcePromptIndexes,
    });
  }

  const ignoredSourcePrompts: IgnoredSourcePrompt[] = [];
  const ignoredIndexes = new Set<number>();
  for (const ignored of input.ignored_source_prompts ?? []) {
    const promptIndex = ignored.source_prompt_index;
    const reason = normalizeText(ignored.reason);
    if (!Number.isInteger(promptIndex) || promptIndex < 1 || promptIndex > prompts.length || !reason) {
      return self.rejected(`Ignored source prompt ${promptIndex} is invalid or lacks a reason.`);
    }
    if (ignoredIndexes.has(promptIndex)) return self.rejected(`Source prompt ${promptIndex} is ignored twice.`);
    if (coveredPromptIndexes.has(promptIndex)) {
      return self.rejected(`Source prompt ${promptIndex} cannot be both referenced and ignored.`);
    }
    ignoredIndexes.add(promptIndex);
    ignoredSourcePrompts.push({ sourcePromptIndex: promptIndex, reason });
  }
  const unclassified = prompts
    .map((_prompt, index) => index + 1)
    .filter((index) => !coveredPromptIndexes.has(index) && !ignoredIndexes.has(index));
  if (unclassified.length > 0) {
    return self.rejected(
      `Every source prompt must be referenced or explicitly ignored; unclassified indexes: ${unclassified.join(", ")}.`,
    );
  }

  const userRequirementsHash = computeUserRequirementsHash(prompts);
  const requirementSetHash = computeRequirementSetHash(requirements, ignoredSourcePrompts);
  self.state = {
    ...self.state,
    requirementAudit: {
      status: "verifying",
      requirements,
      ignoredSourcePrompts,
      nextRequirementIndex: 0,
      userRequirementsHash,
      requirementSetHash,
    },
    readiness: {
      ...(self.state.readiness ?? emptyReadiness()),
      requirementSetHash,
    },
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  return self.updated(
    `Defined ${requirements.length} atomic requirement(s).\n\n${formatRequirementPrompt(requirements[0]!, 0, requirements.length)}`,
    false,
  );
}

function do_recordRequirementVerdict(
  self: TaskVerificationController,
  input: RequirementAuditInput,
): VerificationResult {
  const contextError = auditContextError(self);
  if (contextError) return self.rejected(contextError);
  const audit = self.state.requirementAudit;
  if (audit.status !== "verifying") {
    return self.rejected("No requirement verdict is currently expected. Call ready_to_finish to restart the audit.");
  }
  const requirement = audit.requirements[audit.nextRequirementIndex];
  if (!requirement) return self.rejected("The requirement audit has no pending requirement.");
  if (input.requirement_id !== requirement.id) {
    return self.rejected(`Expected verdict for ${requirement.id}; received ${input.requirement_id ?? "none"}.`);
  }
  if (typeof input.passed !== "boolean") return self.rejected("verdict requires passed: true or false.");
  const reason = normalizeText(input.reason);
  if (!reason) return self.rejected("verdict requires a concrete reason for both passed and failed outcomes.");

  const evidenceRefs = normalizeStrings(input.evidence_refs);
  if (input.passed && evidenceRefs.length === 0) {
    return self.rejected("A passed verdict requires at least one evidence_refs handle.");
  }
  if (evidenceRefs.length > 0) {
    const evidence = self.resolveEvidence(evidenceRefs);
    if (typeof evidence === "string") return self.rejected(evidence);
    if (evidence.some((item) => item.mutationRevision !== self.state.mutationRevision)) {
      return self.rejected(`Verdict evidence must come from mutation revision ${self.state.mutationRevision}.`);
    }
    if (input.passed && evidence.some((item) => item.isError)) {
      return self.rejected("Failed evidence cannot support a passed requirement verdict.");
    }
  }

  const requirements = audit.requirements.map((item) =>
    item.id === requirement.id
      ? {
          ...item,
          verdict: {
            passed: input.passed!,
            reason,
            evidenceRefs,
            mutationRevision: self.state.mutationRevision,
          },
        }
      : item,
  );
  const nextRequirementIndex = audit.nextRequirementIndex + 1;
  if (nextRequirementIndex < requirements.length) {
    self.state = {
      ...self.state,
      requirementAudit: { ...audit, requirements, nextRequirementIndex },
      updatedAt: new Date().toISOString(),
    };
    self.persistState();
    return self.updated(
      `Recorded ${requirement.id}: ${input.passed ? "passed" : "failed"}.\n\n${formatRequirementPrompt(
        requirements[nextRequirementIndex]!,
        nextRequirementIndex,
        requirements.length,
      )}`,
      false,
    );
  }

  const failed = requirements.filter((item) => item.verdict?.passed === false);
  if (failed.length > 0) {
    self.state = {
      ...self.state,
      requirementAudit: {
        ...audit,
        status: "failed",
        requirements,
        nextRequirementIndex,
        verifiedMutationRevision: self.state.mutationRevision,
      },
      readiness: { ...(self.state.readiness ?? emptyReadiness()), status: "evidence_ready", token: undefined },
      updatedAt: new Date().toISOString(),
    };
    self.persistState();
    return self.updated(formatFailedAuditSummary(failed, requirements.length), false);
  }

  const userRequirementsHash = computeUserRequirementsHash(sourcePromptsForState(self.state));
  const requirementSetHash = computeRequirementSetHash(requirements, audit.ignoredSourcePrompts);
  if (
    userRequirementsHash !== audit.userRequirementsHash ||
    requirementSetHash !== audit.requirementSetHash ||
    self.state.readiness?.userRequirementsHash !== userRequirementsHash
  ) {
    return self.rejected("Requirement or source hashes changed during audit. Call ready_to_finish again.");
  }
  const certificateHash = computeCertificateHash(
    self.state.taskId,
    self.state.mutationRevision,
    userRequirementsHash,
    requirementSetHash,
  );
  const token = randomUUID();
  self.state = {
    ...self.state,
    requirementAudit: {
      ...audit,
      status: "passed",
      requirements,
      nextRequirementIndex,
      verifiedMutationRevision: self.state.mutationRevision,
    },
    readiness: {
      ...(self.state.readiness ?? emptyReadiness()),
      status: "completion_ready",
      token,
      verifiedMutationRevision: self.state.mutationRevision,
      userRequirementsHash,
      requirementSetHash,
      certificateHash,
    },
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  return self.updated(
    [
      `Requirement audit passed: ${requirements.length}/${requirements.length}.`,
      `completion_certificate_hash: ${certificateHash}`,
      `verification_token: ${token}`,
      "Pass this token unchanged to finish_work.",
    ].join("\n"),
    false,
  );
}

export function formatRequirementPrompt(requirement: TaskRequirement, index: number, total: number): string {
  return [
    `Verify requirement ${requirement.id} (${index + 1}/${total}):`,
    requirement.text,
    `Acceptance criterion: ${requirement.acceptanceCriterion}`,
    "Inspect current work and evidence, then call:",
    `${REQUIREMENT_AUDIT_TOOL_NAME}({"action":"verdict","requirement_id":"${requirement.id}","passed":true|false,"reason":"concrete evidence or missing work","evidence_refs":["verification-evidence-N"]})`,
    "Use evidence_refs for every passed verdict. Do not submit another audit transition in the same model turn.",
  ].join("\n");
}

function formatFailedAuditSummary(failed: readonly TaskRequirement[], total: number): string {
  return [
    `Requirement audit failed: ${failed.length}/${total} requirement(s) are incomplete.`,
    ...failed.flatMap((requirement) => [
      `${requirement.id}: ${requirement.text}`,
      `Reason: ${requirement.verdict?.reason ?? "No reason recorded"}`,
    ]),
    "No verification_token was issued.",
    "Complete every failed requirement, then call ready_to_finish to re-run the complete audit.",
  ].join("\n");
}
