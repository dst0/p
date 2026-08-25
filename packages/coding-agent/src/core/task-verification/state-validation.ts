import { BASELINE_METHODS, FINAL_METHODS, REQUIREMENT_TYPES, TASK_KINDS } from "./constants.ts";
import { REQUIREMENT_PROOF_POLICIES } from "./requirement-proof-policies.ts";
import { areProofWitnesses } from "./requirement-proof-witnesses.ts";
import { ignoredRequirementSourceIsValid, sourceIdentitiesAreUnique } from "./requirement-source-state-validation.ts";
import { isUnverifiedTestPaths } from "./test-authoring-state-validation.ts";
import type {
  IgnoredSourceClause,
  IgnoredSourcePrompt,
  TaskRequirement,
  TaskRequirementVerdict,
  TaskVerificationAcceptanceCheck,
  TaskVerificationEvidence,
  TaskVerificationRequirementSourceRef,
  TaskVerificationSourcePrompt,
  TaskVerificationState,
} from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isRequirementSourceRef(value: unknown): value is TaskVerificationRequirementSourceRef {
  return (
    isRecord(value) &&
    isNonemptyString(value.id) &&
    isNonemptyString(value.path) &&
    isNonemptyString(value.sha256) &&
    isNonnegativeInteger(value.byteLength) &&
    isNonemptyString(value.snapshotEntryId) &&
    isStringArray(value.referencedByPromptIds) &&
    value.referencedByPromptIds.length > 0 &&
    isNonnegativeInteger(value.capturedAtMutationRevision) &&
    value.origin === "requirement_audit.prepare_definition" &&
    value.policyVersion === 1
  );
}
function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonemptyString(value: unknown): value is string {
  return isString(value) && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || isString(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isOptionalNonnegativeInteger(value: unknown): boolean {
  return value === undefined || isNonnegativeInteger(value);
}

function isOneOf(value: unknown, values: readonly string[]): boolean {
  return typeof value === "string" && values.includes(value);
}

function isSourcePrompt(value: unknown): value is TaskVerificationSourcePrompt {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.text) &&
    (value.kind === undefined || isOneOf(value.kind, ["user_prompt", "referenced_file"])) &&
    isOptionalString(value.path) &&
    isOptionalString(value.sha256)
  );
}

function isAcceptanceCheck(value: unknown): value is TaskVerificationAcceptanceCheck {
  return isRecord(value) && isString(value.criterion) && isStringArray(value.evidenceRefs);
}

function isRequirementVerdict(value: unknown): value is TaskRequirementVerdict {
  return (
    isRecord(value) &&
    typeof value.passed === "boolean" &&
    isString(value.reason) &&
    isStringArray(value.evidenceRefs) &&
    isNonnegativeInteger(value.mutationRevision)
  );
}

function isRequirement(value: unknown): value is TaskRequirement {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isOneOf(value.type, REQUIREMENT_TYPES) &&
    isString(value.text) &&
    isString(value.acceptanceCriterion) &&
    Array.isArray(value.sourcePromptIndexes) &&
    value.sourcePromptIndexes.every((index) => isNonnegativeInteger(index) && index > 0) &&
    (value.sourceClauseIds === undefined || isStringArray(value.sourceClauseIds)) &&
    (value.sourceFacetIds === undefined || isStringArray(value.sourceFacetIds)) &&
    (value.highRisk === undefined || typeof value.highRisk === "boolean") &&
    (value.highRiskSourcePromptIndexes === undefined ||
      (Array.isArray(value.highRiskSourcePromptIndexes) &&
        value.highRiskSourcePromptIndexes.every((index) => isNonnegativeInteger(index) && index > 0))) &&
    (value.proofPolicies === undefined ||
      (Array.isArray(value.proofPolicies) &&
        value.proofPolicies.every((policy) => isOneOf(policy, REQUIREMENT_PROOF_POLICIES)))) &&
    (value.verdict === undefined || isRequirementVerdict(value.verdict))
  );
}

function isIgnoredSourcePrompt(value: unknown): value is IgnoredSourcePrompt {
  return (
    isRecord(value) &&
    isNonnegativeInteger(value.sourcePromptIndex) &&
    value.sourcePromptIndex > 0 &&
    isString(value.reason)
  );
}

function isIgnoredSourceClause(value: unknown): value is IgnoredSourceClause {
  const base =
    isRecord(value) &&
    isNonemptyString(value.sourceClauseId) &&
    isOneOf(value.classification, ["informational", "example", "superseded", "unsafe_instruction"]) &&
    isNonemptyString(value.reason);
  if (!base) return false;
  return value.classification === "superseded"
    ? isNonnegativeInteger(value.supersededBySourcePromptIndex) && value.supersededBySourcePromptIndex > 0
    : value.supersededBySourcePromptIndex === undefined;
}

function isBaseline(value: unknown): value is TaskVerificationState["baseline"] {
  if (!isRecord(value)) return false;
  const evidenceRefs = value.evidenceRefs;
  if (
    typeof value.required !== "boolean" ||
    !isOneOf(value.status, ["not_required", "pending", "satisfied"]) ||
    !isOptionalString(value.hypothesis) ||
    !isOptionalString(value.conclusion) ||
    (value.method !== undefined && !isOneOf(value.method, BASELINE_METHODS)) ||
    !isStringArray(evidenceRefs) ||
    !isStringArray(value.authorizedTestPaths) ||
    typeof value.testSetupChanged !== "boolean"
  ) {
    return false;
  }
  return (
    value.status !== "satisfied" ||
    (isNonemptyString(value.hypothesis) &&
      isNonemptyString(value.conclusion) &&
      isOneOf(value.method, BASELINE_METHODS) &&
      evidenceRefs.length > 0)
  );
}

function isFinal(value: unknown): value is TaskVerificationState["final"] {
  if (!isRecord(value)) return false;
  const evidenceRefs = value.evidenceRefs;
  const unresolvedFailures = value.unresolvedFailures;
  if (
    !isOneOf(value.status, ["pending", "passed", "failed"]) ||
    !isOptionalString(value.expectedBehavior) ||
    !isOptionalString(value.observedBehavior) ||
    (value.method !== undefined && !isOneOf(value.method, FINAL_METHODS)) ||
    !isStringArray(evidenceRefs) ||
    !isStringArray(unresolvedFailures) ||
    !isOptionalNonnegativeInteger(value.verifiedMutationRevision)
  ) {
    return false;
  }
  if (value.status === "pending") return true;
  return (
    isOneOf(value.method, FINAL_METHODS) &&
    evidenceRefs.length > 0 &&
    isNonnegativeInteger(value.verifiedMutationRevision) &&
    (value.status !== "passed" || unresolvedFailures.length === 0)
  );
}

function isReadiness(value: unknown): value is NonNullable<TaskVerificationState["readiness"]> {
  if (!isRecord(value)) return false;
  const acceptanceChecks = value.acceptanceChecks;
  if (
    !isOneOf(value.status, ["pending", "evidence_ready", "completion_ready"]) ||
    !isOptionalString(value.token) ||
    !Array.isArray(acceptanceChecks) ||
    !acceptanceChecks.every(isAcceptanceCheck) ||
    !isOptionalNonnegativeInteger(value.verifiedMutationRevision) ||
    !isOptionalString(value.userRequirementsHash) ||
    !isOptionalString(value.requirementSetHash) ||
    !isOptionalString(value.certificateHash)
  ) {
    return false;
  }
  if (value.status === "pending") return acceptanceChecks.length === 0;
  if (
    acceptanceChecks.length === 0 ||
    !isNonnegativeInteger(value.verifiedMutationRevision) ||
    !isNonemptyString(value.userRequirementsHash)
  ) {
    return false;
  }
  return (
    value.status !== "completion_ready" ||
    (isNonemptyString(value.token) &&
      isNonemptyString(value.requirementSetHash) &&
      isNonemptyString(value.certificateHash))
  );
}

function isRequirementAudit(value: unknown): value is TaskVerificationState["requirementAudit"] {
  if (
    !isRecord(value) ||
    !isOneOf(value.status, ["pending", "awaiting_definition", "verifying", "failed", "passed"]) ||
    !Array.isArray(value.requirements) ||
    !value.requirements.every(isRequirement) ||
    !Array.isArray(value.ignoredSourcePrompts) ||
    !value.ignoredSourcePrompts.every(isIgnoredSourcePrompt) ||
    (value.ignoredSourceClauses !== undefined &&
      (!Array.isArray(value.ignoredSourceClauses) || !value.ignoredSourceClauses.every(isIgnoredSourceClause))) ||
    !isNonnegativeInteger(value.nextRequirementIndex) ||
    !isOptionalString(value.userRequirementsHash) ||
    !isOptionalString(value.requirementSetHash) ||
    !isOptionalNonnegativeInteger(value.verifiedMutationRevision)
  ) {
    return false;
  }
  const requirements = value.requirements;
  const hasNoVerdicts = requirements.every((requirement) => requirement.verdict === undefined);
  if (value.status === "pending") return value.nextRequirementIndex === 0 && hasNoVerdicts;
  if (value.status === "awaiting_definition") {
    return value.nextRequirementIndex === 0 && requirements.length === 0;
  }
  if (value.status === "verifying") {
    return (
      value.nextRequirementIndex === 0 &&
      requirements.length > 0 &&
      hasNoVerdicts &&
      isNonemptyString(value.userRequirementsHash) &&
      isNonemptyString(value.requirementSetHash)
    );
  }
  const everyVerdictExists = requirements.length > 0 && requirements.every((requirement) => requirement.verdict);
  if (
    value.nextRequirementIndex !== requirements.length ||
    !everyVerdictExists ||
    !isNonnegativeInteger(value.verifiedMutationRevision)
  ) {
    return false;
  }
  return value.status === "passed"
    ? requirements.every((requirement) => requirement.verdict?.passed === true)
    : requirements.some((requirement) => requirement.verdict?.passed === false);
}

export function isTaskVerificationState(value: unknown): value is TaskVerificationState {
  return (
    isRecord(value) &&
    value.version === 2 &&
    isString(value.taskId) &&
    (value.taskKind === undefined || isOneOf(value.taskKind, TASK_KINDS)) &&
    isOptionalString(value.taskSummary) &&
    isOptionalString(value.taskContext) &&
    (value.taskPrompts === undefined ||
      (Array.isArray(value.taskPrompts) &&
        value.taskPrompts.every((prompt) => isSourcePrompt(prompt) && prompt.kind !== "referenced_file"))) &&
    (value.requirementSourceRefs === undefined ||
      (Array.isArray(value.requirementSourceRefs) && value.requirementSourceRefs.every(isRequirementSourceRef))) &&
    (value.ignoredRequirementSources === undefined ||
      (Array.isArray(value.ignoredRequirementSources) &&
        value.ignoredRequirementSources.every(ignoredRequirementSourceIsValid))) &&
    isUnverifiedTestPaths(value.unverifiedTestPaths) &&
    (value.unverifiedTestPathOverflow === undefined || typeof value.unverifiedTestPathOverflow === "boolean") &&
    sourceIdentitiesAreUnique(value.requirementSourceRefs ?? [], value.ignoredRequirementSources ?? []) &&
    isNonnegativeInteger(value.mutationRevision) &&
    isBaseline(value.baseline) &&
    isFinal(value.final) &&
    (value.readiness === undefined || isReadiness(value.readiness)) &&
    isRequirementAudit(value.requirementAudit) &&
    isString(value.updatedAt)
  );
}

export function isTaskVerificationEvidence(value: unknown): value is TaskVerificationEvidence {
  return (
    isRecord(value) &&
    value.version === 2 &&
    isString(value.taskId) &&
    isString(value.ref) &&
    isString(value.toolCallId) &&
    isString(value.toolName) &&
    isString(value.descriptor) &&
    isString(value.outputSummary) &&
    value.passedTestNames === undefined &&
    areProofWitnesses(value.proofWitnesses) &&
    typeof value.isError === "boolean" &&
    isNonnegativeInteger(value.mutationRevision) &&
    isString(value.timestamp)
  );
}
