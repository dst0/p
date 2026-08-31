import type { TaskVerificationAcceptanceCheck, TaskVerificationState } from "./types.ts";

export function readinessIsValid(
  value: unknown,
  mode: unknown,
): value is NonNullable<TaskVerificationState["readiness"]> {
  if (!isRecord(value)) return false;
  const checks = value.acceptanceChecks;
  if (
    !includes(["pending", "evidence_ready", "completion_ready"], value.status) ||
    !optionalString(value.token) ||
    !Array.isArray(checks) ||
    !checks.every(isAcceptanceCheck) ||
    !optionalInteger(value.verifiedMutationRevision) ||
    !optionalString(value.userRequirementsHash) ||
    !optionalString(value.requirementSetHash) ||
    !optionalString(value.certificateHash) ||
    !optionalString(value.effectStateHash)
  ) {
    return false;
  }
  if (value.status === "pending") return checks.length === 0;
  if (checks.length === 0 || !isInteger(value.verifiedMutationRevision)) return false;
  if (mode === "evidence") {
    return (
      value.status === "completion_ready" &&
      nonempty(value.token) &&
      typeof value.effectStateHash === "string" &&
      /^[a-f0-9]{64}$/u.test(value.effectStateHash) &&
      value.userRequirementsHash === undefined &&
      value.requirementSetHash === undefined &&
      value.certificateHash === undefined
    );
  }
  if (!nonempty(value.userRequirementsHash)) return false;
  return (
    value.status !== "completion_ready" ||
    (nonempty(value.token) && nonempty(value.requirementSetHash) && nonempty(value.certificateHash))
  );
}

function isAcceptanceCheck(value: unknown): value is TaskVerificationAcceptanceCheck {
  return isRecord(value) && typeof value.criterion === "string" && stringArray(value.evidenceRefs);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function optionalInteger(value: unknown): boolean {
  return value === undefined || isInteger(value);
}

function includes(values: readonly string[], value: unknown): boolean {
  return typeof value === "string" && values.includes(value);
}
