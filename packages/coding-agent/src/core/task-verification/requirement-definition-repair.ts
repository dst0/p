import { randomUUID } from "node:crypto";
import type { RequirementAuditInput } from "./types.ts";

export interface RejectedRequirementDefinitionDraft {
  revision: string;
  input: RequirementAuditInput;
}

export function rejectedRequirementDefinitionDraft(
  input: RequirementAuditInput,
): RejectedRequirementDefinitionDraft | undefined {
  if (input.action !== "define" || !input.requirements) return undefined;
  return {
    revision: randomUUID(),
    input: {
      action: "define",
      requirements: structuredClone(input.requirements),
      ignored_source_prompts: structuredClone(input.ignored_source_prompts ?? []),
      ignored_source_clauses: structuredClone(input.ignored_source_clauses ?? []),
    },
  };
}

export function repairRejectedRequirementDefinition(
  draft: RejectedRequirementDefinitionDraft | undefined,
  repair: RequirementAuditInput,
): RequirementAuditInput | string {
  if (!draft || repair.definition_revision !== draft.revision) {
    return "The definition_revision is stale or unavailable. Resubmit one complete definition batch.";
  }
  const repairs = repair.requirement_repairs ?? [];
  const duplicateIndexes = repairs
    .map((item) => item.requirement_index)
    .filter((index, offset, indexes) => indexes.indexOf(index) !== offset);
  if (duplicateIndexes.length > 0) {
    return `requirement_repairs contains duplicate requirement indexes: ${[...new Set(duplicateIndexes)].join(", ")}.`;
  }
  const requirements = draft.input.requirements ?? [];
  const invalidIndexes = repairs
    .map((item) => item.requirement_index)
    .filter((index) => index < 1 || index > requirements.length);
  if (invalidIndexes.length > 0) {
    return `requirement_repairs references invalid rejected-batch indexes: ${invalidIndexes.join(", ")}.`;
  }
  const repairsByIndex = new Map(repairs.map((item) => [item.requirement_index, item.replacements]));
  return {
    action: "define",
    requirements: requirements.flatMap((requirement, offset) =>
      structuredClone(repairsByIndex.get(offset + 1) ?? [requirement]),
    ),
    ignored_source_prompts: structuredClone(repair.ignored_source_prompts ?? draft.input.ignored_source_prompts ?? []),
    ignored_source_clauses: structuredClone(repair.ignored_source_clauses ?? draft.input.ignored_source_clauses ?? []),
  };
}

export function formatRejectedDefinitionRepairGuidance(
  message: string,
  draft: RejectedRequirementDefinitionDraft | undefined,
): string {
  return [
    message,
    ...(draft
      ? [
          `definition_revision: ${draft.revision}`,
          'For small corrections, call action "repair_definition" with this revision and requirement_repairs. Each repair atomically replaces one 1-based rejected-batch item with zero or more replacements; omitted items and classifications are retained.',
          "The rejected draft is non-authoritative. The controller reconstructs and validates the complete batch before accepting any requirement or permitting mutation.",
        ]
      : [
          "Correct every diagnostic and resubmit the complete definition batch; rejection stored no authoritative requirement definition.",
        ]),
    'The original requirement-source catalog remains authoritative. If compaction hid it, call record_task_verification with action "status" to restore the current definition instructions.',
  ].join("\n\n");
}
