import type { RequirementAuditInput } from "./types.ts";

interface RepairTargetBase {
  diagnostic: string;
}

type RequirementInput = NonNullable<RequirementAuditInput["requirements"]>[number];

export type RequirementDefinitionRepairTarget =
  | (RepairTargetBase & { kind: "requirement"; requirementIndex: number })
  | (RepairTargetBase & {
      kind: "duplicate_consolidation";
      requirementIndex: number;
      preservedRequirementIndex: number;
      removedRequirementIndexes: number[];
    })
  | (RepairTargetBase & { kind: "ignored_clause_removal"; sourceClauseId: string })
  | (RepairTargetBase & { kind: "clause_addition"; sourceClauseId: string })
  | (RepairTargetBase & { kind: "clause_classify_or_add"; sourceClauseId: string })
  | (RepairTargetBase & { kind: "prompt_classify_or_add"; sourcePromptIndex: number })
  | (RepairTargetBase & { kind: "diagnostic_only" });

const REQUIREMENT_TYPES = new Set(["behavior", "constraint", "deliverable", "verification", "workflow"]);

export function firstRequirementDefinitionDiagnostic(diagnostics: string): string | undefined {
  const numbered = diagnostics.match(/^\s*\d+\.\s+(.+?)\s*$/mu)?.[1]?.trim();
  if (numbered) return withoutGeneratedDiagnosticCount(numbered);
  const single = diagnostics.trim();
  return single && !single.startsWith("Requirement definition has ") ? single : undefined;
}

export function selectRequirementDefinitionRepairTarget(
  diagnostics: string,
  knownNormativeSourceClauseIds: readonly string[] = [],
  requirements: readonly RequirementInput[] = [],
): RequirementDefinitionRepairTarget | undefined {
  const diagnostic = firstRequirementDefinitionDiagnostic(diagnostics);
  if (!diagnostic) return undefined;

  const requirementIndex = diagnostic.match(/^Requirement\s+(\d+)(?::|\s)/u)?.[1];
  if (requirementIndex) {
    return { kind: "requirement", requirementIndex: Number(requirementIndex), diagnostic };
  }

  const indexedDuplicate = diagnostic.match(
    /^Duplicate requirement:\s*Requirement\s+(\d+)\s+duplicates\s+Requirement\s+(\d+):\s*(.+)$/u,
  );
  const duplicateText = indexedDuplicate?.[3] ?? diagnostic.match(/^Duplicate requirement:\s*(.+)$/u)?.[1];
  if (duplicateText) {
    const duplicateGroups = new Map<string, number[]>();
    for (const [index, requirement] of requirements.entries()) {
      if (
        !indexedDuplicate &&
        normalizeDiagnostic(requirement.text).toLowerCase() !== normalizeDiagnostic(duplicateText).toLowerCase()
      ) {
        continue;
      }
      const key = `${requirement.type}\n${normalizeDiagnostic(requirement.text).toLowerCase()}\n${normalizeDiagnostic(requirement.acceptance_criterion).toLowerCase()}`;
      const group = duplicateGroups.get(key) ?? [];
      group.push(index + 1);
      duplicateGroups.set(key, group);
    }
    const indexedDuplicateRequirement = indexedDuplicate?.[1] ? Number(indexedDuplicate[1]) : undefined;
    const indexedPreservedRequirement = indexedDuplicate?.[2] ? Number(indexedDuplicate[2]) : undefined;
    const duplicateIndexes = [...duplicateGroups.values()].find(
      (indexes) =>
        indexes.length > 1 &&
        (indexedDuplicateRequirement === undefined ||
          (indexes.includes(indexedDuplicateRequirement) && indexes[0] === indexedPreservedRequirement)),
    );
    if (duplicateIndexes) {
      return {
        kind: "duplicate_consolidation",
        requirementIndex: duplicateIndexes[1]!,
        preservedRequirementIndex: duplicateIndexes[0]!,
        removedRequirementIndexes: duplicateIndexes.slice(1),
        diagnostic,
      };
    }
  }

  const ignoredClause =
    diagnostic.match(/^Ignored source clause\s+([^\s,.;:()]+)\s+is invalid or lacks a reason\.$/u)?.[1] ??
    diagnostic.match(
      /^Source clause\s+([^\s,.;:()]+)\s+(?:must use classification unsafe_instruction|is not a controller-detected unsafe instruction and cannot use unsafe_instruction|is normative and cannot be ignored as (?:informational|example)|is not structurally (?:informational|an example)|may name superseded_by_source_prompt_index only with classification superseded|cannot be both mapped and ignored|is ignored twice)\.$/u,
    )?.[1] ??
    diagnostic.match(/^Superseded source clause\s+([^\s,.;:()]+)\s+requires a direct user prompt index\.$/u)?.[1] ??
    diagnostic.match(
      /^Direct user prompt\s+\d+\s+does not conflict with or supersede source clause\s+([^\s,.;:()]+)\.$/u,
    )?.[1];
  if (ignoredClause) return { kind: "ignored_clause_removal", sourceClauseId: ignoredClause, diagnostic };

  const unclassifiedClause = diagnostic.match(/unclassified source_clause_ids:\s*([^,\s.]+)/iu)?.[1];
  if (unclassifiedClause) {
    if (knownNormativeSourceClauseIds.includes(unclassifiedClause)) {
      return { kind: "clause_addition", sourceClauseId: unclassifiedClause, diagnostic };
    }
    return { kind: "clause_classify_or_add", sourceClauseId: unclassifiedClause, diagnostic };
  }

  const unclassifiedPrompt = diagnostic.match(/unclassified indexes:\s*(\d+)/iu)?.[1];
  if (unclassifiedPrompt) {
    return { kind: "prompt_classify_or_add", sourcePromptIndex: Number(unclassifiedPrompt), diagnostic };
  }

  return { kind: "diagnostic_only", diagnostic };
}

export function requirementAuditInputTargetsSelectedRepair(
  input: RequirementAuditInput,
  target: RequirementDefinitionRepairTarget,
): boolean {
  if (input.action !== "repair_definition" || !input.definition_revision?.trim() || repairItemCount(input) !== 1) {
    return false;
  }
  if (hasDefineOnlyFields(input)) return false;

  switch (target.kind) {
    case "requirement":
      return (
        input.requirement_repairs?.length === 1 &&
        input.requirement_repairs[0]?.requirement_index === target.requirementIndex &&
        input.requirement_repairs[0].replacements.every(isCompleteRequirement)
      );
    case "duplicate_consolidation":
      return (
        input.requirement_repairs?.length === 1 &&
        input.requirement_repairs[0]?.requirement_index === target.requirementIndex &&
        input.requirement_repairs[0].replacements.length === 0
      );
    case "ignored_clause_removal":
      return exactStringArray(input.ignored_source_clause_removals, target.sourceClauseId);
    case "clause_addition":
      return (
        isCompleteRequirement(input.requirement_addition) &&
        exactStringArray(input.requirement_addition.source_clause_ids, target.sourceClauseId) &&
        hasNoOtherProvenance(input.requirement_addition, "clause")
      );
    case "clause_classify_or_add":
      return (
        (isCompleteRequirement(input.requirement_addition) &&
          exactStringArray(input.requirement_addition.source_clause_ids, target.sourceClauseId) &&
          hasNoOtherProvenance(input.requirement_addition, "clause")) ||
        (input.ignored_source_clause_upserts?.length === 1 &&
          input.ignored_source_clause_upserts[0]?.source_clause_id === target.sourceClauseId &&
          Boolean(input.ignored_source_clause_upserts[0].reason.trim()))
      );
    case "prompt_classify_or_add":
      return (
        (isCompleteRequirement(input.requirement_addition) &&
          exactNumberArray(input.requirement_addition.source_prompt_indexes, target.sourcePromptIndex) &&
          hasNoOtherProvenance(input.requirement_addition, "prompt")) ||
        (input.ignored_source_prompt_upserts?.length === 1 &&
          input.ignored_source_prompt_upserts[0]?.source_prompt_index === target.sourcePromptIndex &&
          Boolean(input.ignored_source_prompt_upserts[0].reason.trim()))
      );
    case "diagnostic_only":
      return true;
  }
}

export function selectedRequirementDefinitionDiagnosticDisappeared(
  target: RequirementDefinitionRepairTarget,
  candidateDiagnostics: string,
): boolean {
  const normalizedTarget = normalizeDiagnostic(target.diagnostic);
  const diagnostics = numberedDiagnostics(candidateDiagnostics);
  const candidateItems =
    diagnostics.length > 0
      ? diagnostics
      : [firstRequirementDefinitionDiagnostic(candidateDiagnostics)].filter(
          (diagnostic): diagnostic is string => diagnostic !== undefined,
        );
  return !candidateItems.some((diagnostic) => normalizeDiagnostic(diagnostic) === normalizedTarget);
}

export function formatSelectedRequirementDefinitionRepairGuidance(
  target: RequirementDefinitionRepairTarget,
  definitionRevision: string,
): string {
  const prefix = `Use action "repair_definition" with definition_revision ${JSON.stringify(definitionRevision)}.`;
  switch (target.kind) {
    case "requirement":
      return `${prefix} Repair only Requirement ${target.requirementIndex} with one requirement_repairs entry for requirement_index ${target.requirementIndex}. Supply complete replacement objects; omitted fields are deleted.`;
    case "duplicate_consolidation":
      return `${prefix} Consolidate duplicate group Requirements ${target.removedRequirementIndexes.join(", ")} into Requirement ${target.preservedRequirementIndex} with the one semantic repair requirement_repairs:${JSON.stringify([{ requirement_index: target.requirementIndex, replacements: [] }])}. The controller removes every listed duplicate and unions all provenance into the preserved requirement.`;
    case "ignored_clause_removal":
      return `${prefix} Remove only the invalid ignored classification with ignored_source_clause_removals:${JSON.stringify([target.sourceClauseId])}.`;
    case "clause_addition":
      return `${prefix} ${target.sourceClauseId} is known normative. Add only one complete requirement_addition with source_clause_ids:${JSON.stringify([target.sourceClauseId])}; omit source_prompt_indexes and source_facet_ids. Classification as non-requirement is not accepted.`;
    case "clause_classify_or_add":
      return `${prefix} Repair only ${target.sourceClauseId}: submit one complete requirement_addition with source_clause_ids:${JSON.stringify([target.sourceClauseId])} and omit source_prompt_indexes and source_facet_ids, or classify only that clause with ignored_source_clause_upserts.`;
    case "prompt_classify_or_add":
      return `${prefix} Repair only direct prompt ${target.sourcePromptIndex}: submit one complete requirement_addition with source_prompt_indexes:${JSON.stringify([target.sourcePromptIndex])} and omit source_clause_ids and source_facet_ids, or classify only that prompt with ignored_source_prompt_upserts.`;
    case "diagnostic_only":
      return `${prefix} Resolve only this diagnostic with one complete repair item: ${target.diagnostic}`;
  }
}

function repairItemCount(input: RequirementAuditInput): number {
  return (
    (input.requirement_repairs?.length ?? 0) +
    (input.requirement_addition ? 1 : 0) +
    (input.ignored_source_prompt_upserts?.length ?? 0) +
    (input.ignored_source_prompt_removals?.length ?? 0) +
    (input.ignored_source_clause_upserts?.length ?? 0) +
    (input.ignored_source_clause_removals?.length ?? 0)
  );
}

function hasDefineOnlyFields(input: RequirementAuditInput): boolean {
  return Boolean(
    input.requirements ||
      input.ignored_source_prompts ||
      input.ignored_source_clauses ||
      input.selected_paths ||
      input.adopt_changed_paths ||
      input.ignored_paths ||
      input.verdicts,
  );
}

function isCompleteRequirement(
  requirement: unknown,
): requirement is NonNullable<RequirementAuditInput["requirement_addition"]> {
  if (!requirement || typeof requirement !== "object") return false;
  const candidate = requirement as Record<string, unknown>;
  return (
    typeof candidate.type === "string" &&
    REQUIREMENT_TYPES.has(candidate.type) &&
    typeof candidate.text === "string" &&
    candidate.text.trim().length > 0 &&
    typeof candidate.acceptance_criterion === "string" &&
    candidate.acceptance_criterion.trim().length > 0
  );
}

function hasNoOtherProvenance(
  requirement: NonNullable<RequirementAuditInput["requirement_addition"]>,
  selected: "clause" | "prompt",
): boolean {
  return selected === "clause"
    ? requirement.source_prompt_indexes === undefined && requirement.source_facet_ids === undefined
    : requirement.source_clause_ids === undefined && requirement.source_facet_ids === undefined;
}

function exactStringArray(values: readonly string[] | undefined, expected: string): boolean {
  return values?.length === 1 && values[0] === expected;
}

function exactNumberArray(values: readonly number[] | undefined, expected: number): boolean {
  return values?.length === 1 && values[0] === expected;
}

function numberedDiagnostics(diagnostics: string): string[] {
  return [...diagnostics.matchAll(/^\s*\d+\.\s+(.+?)\s*$/gmu)].map((match) =>
    withoutGeneratedDiagnosticCount(match[1]?.trim() ?? ""),
  );
}

function withoutGeneratedDiagnosticCount(diagnostic: string): string {
  return diagnostic.replace(/\s+\[\d+\s+instances?\]\s*$/u, "").trim();
}

function normalizeDiagnostic(diagnostic: string): string {
  return diagnostic.trim().replace(/\s+/gu, " ");
}
