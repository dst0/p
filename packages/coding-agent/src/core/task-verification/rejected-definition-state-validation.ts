import { Value } from "typebox/value";
import { MAX_REQUIREMENT_COUNT, MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS } from "./constants.ts";
import { RequirementAuditInputSchema } from "./requirement-audit-schema.ts";
import { MAX_REQUIREMENT_DEFINITION_DIAGNOSTIC_BYTES } from "./requirement-definition-diagnostics.ts";
import type { PersistedRejectedRequirementDefinitionDraft } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedCounter(value: unknown, maximum: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function areBoundedClauseIds(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 128) return false;
  const ids = value.filter((id): id is string => typeof id === "string");
  return (
    ids.length === value.length &&
    new Set(ids).size === ids.length &&
    ids.every((id) => id.length <= 80 && /^S[1-9]\d*-C[1-9]\d*$/u.test(id)) &&
    ids.reduce((bytes, id) => bytes + Buffer.byteLength(id, "utf8"), 0) <= 4_096
  );
}

export function isPersistedRejectedDefinitionDraft(
  value: unknown,
): value is PersistedRejectedRequirementDefinitionDraft {
  if (!isRecord(value) || !isRecord(value.input)) return false;
  let inputWithinLimit: boolean;
  try {
    inputWithinLimit =
      Buffer.byteLength(JSON.stringify(value.input), "utf8") <= MAX_REQUIREMENT_DEFINITION_DIAGNOSTIC_BYTES;
  } catch {
    return false;
  }
  return (
    typeof value.revision === "string" &&
    value.revision.length > 0 &&
    value.revision.length <= 80 &&
    typeof value.diagnostics === "string" &&
    value.diagnostics.length > 0 &&
    Buffer.byteLength(value.diagnostics, "utf8") <= MAX_REQUIREMENT_DEFINITION_DIAGNOSTIC_BYTES &&
    inputWithinLimit &&
    Value.Check(RequirementAuditInputSchema, value.input) &&
    value.input.action === "define" &&
    areBoundedClauseIds(value.knownNormativeSourceClauseIds) &&
    isBoundedCounter(value.repairLineageBaselineRequirementCount, MAX_REQUIREMENT_COUNT) &&
    isBoundedCounter(value.bestDiagnosticCount, MAX_REQUIREMENT_COUNT * 256) &&
    isBoundedCounter(value.unproductiveRepairAttempts, MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS)
  );
}
