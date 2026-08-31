import { randomUUID } from "node:crypto";
import {
  computeCertificateHash,
  computeRequirementSetHash,
  computeStateUserRequirementsHash,
} from "../requirement-audit-hashing.ts";
import { emptyReadiness } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type { RequirementAuditInput, TaskRequirement, TaskRequirementVerdict, VerificationResult } from "../types.ts";
import { auditContextError } from "./requirement-audit-context.ts";
import { do_defineRequirements } from "./requirement-definition.ts";
import { do_prepareRequirementDefinition } from "./requirement-source-preparation.ts";
import { validateRequirementVerdict } from "./requirement-verdict-validation.ts";

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
  if (input.action === "repair_definition") {
    return self.rejected(
      "No matching rejected definition draft is available. Resubmit one complete definition batch to establish a new repair revision.",
    );
  }
  const transitionError = self.beginAuditTransition();
  if (transitionError) return self.rejected(transitionError);
  if (input.action === "prepare_definition") return do_prepareRequirementDefinition(self, input);
  if (input.action === "define") return do_defineRequirements(self, input);
  return do_recordRequirementVerdicts(self, input);
}

function do_recordRequirementVerdicts(
  self: TaskVerificationController,
  input: RequirementAuditInput,
): VerificationResult {
  const contextError = auditContextError(self);
  if (contextError) return self.rejected(contextError);
  const audit = self.state.requirementAudit;
  if (audit.status !== "verifying") {
    return self.rejected(
      "No requirement verdict batch is currently expected. Call ready_to_finish to restart the audit.",
    );
  }
  if (audit.nextRequirementIndex !== 0 || audit.requirements.some((requirement) => requirement.verdict)) {
    return self.rejected(
      "The requirement audit contains partial or corrupted verdict state. Call ready_to_finish to restart the complete batch.",
    );
  }
  const requestedVerdicts = input.action === "verdict" ? (input.verdicts ?? []) : [];
  const verdictsById = new Map<string, (typeof requestedVerdicts)[number]>();
  for (const verdict of requestedVerdicts) {
    if (verdictsById.has(verdict.requirement_id)) {
      return self.rejected(`Duplicate verdicts: ${verdict.requirement_id}.`);
    }
    verdictsById.set(verdict.requirement_id, verdict);
  }
  const expectedIds = new Set(audit.requirements.map((requirement) => requirement.id));
  const unexpected = [...verdictsById.keys()].filter((id) => !expectedIds.has(id));
  if (unexpected.length > 0) return self.rejected(`Unexpected verdicts: ${unexpected.join(", ")}.`);
  const missing = audit.requirements.filter((requirement) => !verdictsById.has(requirement.id));
  if (missing.length > 0) return self.rejected(`Missing verdicts: ${missing.map((item) => item.id).join(", ")}.`);

  const validatedVerdicts = new Map<string, TaskRequirementVerdict>();
  const validationErrors: string[] = [];
  for (const requirement of audit.requirements) {
    const requestedVerdict = verdictsById.get(requirement.id)!;
    const validated = validateRequirementVerdict(self, requirement, requestedVerdict);
    if (typeof validated === "string") validationErrors.push(validated);
    else validatedVerdicts.set(requirement.id, validated);
  }
  if (validationErrors.length > 0) {
    return self.rejected(
      [
        ...validationErrors,
        "No verdicts were recorded. Collect all missing current and focused evidence, then resubmit one complete verdict batch.",
      ].join("\n"),
    );
  }

  const requirements = audit.requirements.map((requirement) => ({
    ...requirement,
    verdict: validatedVerdicts.get(requirement.id)!,
  }));
  const nextRequirementIndex = requirements.length;
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

  const userRequirementsHash = computeStateUserRequirementsHash(self.state);
  const requirementSetHash = computeRequirementSetHash(
    requirements,
    audit.ignoredSourcePrompts,
    audit.ignoredSourceClauses ?? [],
  );
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
      completionSummary: self.state.readiness?.completionSummary,
    },
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  return self.updated(
    [
      `Requirement audit passed: ${requirements.length}/${requirements.length}.`,
      `completion_certificate_hash: ${certificateHash}`,
      `verification_token: ${token}`,
      "The controller accepted verified terminal completion; no additional model turn is required.",
    ].join("\n"),
    false,
  );
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
