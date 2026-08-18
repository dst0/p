import { BASELINE_METHODS, FINAL_METHODS, REQUIREMENT_TYPES, TASK_KINDS } from "./constants.ts";
import type {
  IgnoredSourcePrompt,
  TaskRequirement,
  TaskRequirementVerdict,
  TaskVerificationAcceptanceCheck,
  TaskVerificationEvidence,
  TaskVerificationSourcePrompt,
  TaskVerificationState,
} from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return isRecord(value) && isString(value.id) && isString(value.text);
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
  return (
    isRecord(value) &&
    isOneOf(value.status, ["pending", "awaiting_definition", "verifying", "failed", "passed"]) &&
    Array.isArray(value.requirements) &&
    value.requirements.every(isRequirement) &&
    Array.isArray(value.ignoredSourcePrompts) &&
    value.ignoredSourcePrompts.every(isIgnoredSourcePrompt) &&
    isNonnegativeInteger(value.nextRequirementIndex) &&
    value.nextRequirementIndex <= value.requirements.length &&
    isOptionalString(value.userRequirementsHash) &&
    isOptionalString(value.requirementSetHash) &&
    isOptionalNonnegativeInteger(value.verifiedMutationRevision)
  );
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
      (Array.isArray(value.taskPrompts) && value.taskPrompts.every(isSourcePrompt))) &&
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
    typeof value.isError === "boolean" &&
    isNonnegativeInteger(value.mutationRevision) &&
    isString(value.timestamp)
  );
}
