export const MAX_REQUIREMENT_DEFINITION_DIAGNOSTIC_BYTES = 32_768;

const MAX_REPAIR_CLASS_EXAMPLE_BYTES = 320;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/gu;

const REPAIR_CLASS_PATTERNS = [
  ["unsupported_type", /has an unsupported type\./u],
  ["missing_text", /needs concrete text and acceptance_criterion\./u],
  ["compound", /is compound:/u],
  ["duplicate_requirement", /Duplicate requirement:/u],
  ["invalid_prompt_index", /references an invalid source_prompt_index\./u],
  ["invalid_clause_id", /references an invalid source_clause_id\./u],
  ["invalid_facet_id", /references an invalid source_facet_id\./u],
  ["multiple_facets", /maps multiple source facets/u],
  ["missing_facet_mapping", /maps faceted source clauses without source_facet_ids:/u],
  ["unsafe_mapped_clause", /is an unsafe delegated instruction/u],
  ["clause_prompt_mismatch", /maps source clause .* without its source_prompt_index\./u],
  ["polarity_reversal", /has behavioral polarity that the mapped requirement reverses\./u],
  ["semantic_mismatch", /does not semantically support the mapped requirement\./u],
  ["facet_constraint", /Source facet .* is missing/u],
  ["referenced_source_mapping", /must map every referenced-file source index/u],
  ["invalid_ignored_clause", /Ignored source clause .* is invalid or lacks a reason\./u],
  ["unsafe_classification_required", /must use classification unsafe_instruction\./u],
  ["unsafe_classification_invalid", /cannot use unsafe_instruction\./u],
  ["normative_informational", /cannot be ignored as informational\./u],
  ["invalid_example", /cannot be ignored as example\.|is not structurally an example\./u],
  ["invalid_supersession_field", /may name superseded_by_source_prompt_index only/u],
  ["invalid_supersession_index", /requires a direct user prompt index\./u],
  ["invalid_supersession", /does not conflict with or supersede source clause/u],
  ["mapped_and_ignored_clause", /cannot be both mapped and ignored\./u],
  ["duplicate_ignored_clause", /Source clause .* is ignored twice\./u],
  ["unclassified_clause", /unclassified source_clause_ids:/u],
  ["uncovered_concept", /has uncovered normative concepts?:/u],
  ["uncovered_facet", /has uncovered source facets:/u],
  ["derived_proof_boundary", /newline-terminated artifact that rejects truncation/u],
  ["invalid_ignored_prompt", /Ignored source prompt .* is invalid or lacks a reason\./u],
  ["referenced_prompt_ignored", /Referenced requirement source .* cannot be ignored\./u],
  ["duplicate_ignored_prompt", /Source prompt .* is ignored twice\./u],
  ["referenced_and_ignored_prompt", /Source prompt .* cannot be both referenced and ignored\./u],
  ["unclassified_prompt", /unclassified indexes:/u],
] as const;

interface DiagnosticGroup {
  count: number;
  example: string;
}

export function formatRequirementDefinitionDiagnostics(diagnostics: readonly string[]): string {
  const normalized = diagnostics.map(normalizeDiagnostic);
  const ordinary = formatOrdinaryDiagnostics(normalized);
  if (Buffer.byteLength(ordinary, "utf8") <= MAX_REQUIREMENT_DEFINITION_DIAGNOSTIC_BYTES) return ordinary;

  const groups = new Map<string, DiagnosticGroup>();
  for (const diagnostic of normalized) {
    const key = repairClassKey(diagnostic);
    const group = groups.get(key);
    if (group) {
      group.count += 1;
    } else {
      groups.set(key, { count: 1, example: diagnostic });
    }
  }
  const represented = [...groups.values()];
  const omittedInstances = diagnostics.length - represented.length;
  const bounded = [
    `Requirement definition has ${diagnostics.length} deterministic validation errors across ${represented.length} repair classes; detailed output was bounded to ${MAX_REQUIREMENT_DEFINITION_DIAGNOSTIC_BYTES} UTF-8 bytes:`,
    ...represented.map(
      (group, index) =>
        `${index + 1}. ${truncateUtf8(group.example, MAX_REPAIR_CLASS_EXAMPLE_BYTES)} [${group.count} ${group.count === 1 ? "instance" : "instances"}]`,
    ),
    `${omittedInstances} additional diagnostic instances are not expanded; every repair class is represented above. Repair only the controller-selected concrete item, then rerun validation to reveal the next target.`,
  ].join("\n");
  return truncateUtf8(bounded, MAX_REQUIREMENT_DEFINITION_DIAGNOSTIC_BYTES);
}

function formatOrdinaryDiagnostics(diagnostics: readonly string[]): string {
  if (diagnostics.length === 1) return diagnostics[0]!;
  return [
    `Requirement definition has ${diagnostics.length} deterministic validation errors:`,
    ...diagnostics.map((diagnostic, index) => `${index + 1}. ${diagnostic}`),
  ].join("\n");
}

function repairClassKey(diagnostic: string): string {
  return REPAIR_CLASS_PATTERNS.find((entry) => entry[1].test(diagnostic))?.[0] ?? "other";
}

function normalizeDiagnostic(value: string): string {
  return value.replace(CONTROL_CHARACTER_PATTERN, " ").replace(/\s+/gu, " ").trim();
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const suffix = "...";
  const contentBytes = maxBytes - Buffer.byteLength(suffix, "utf8");
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > contentBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return `${result}${suffix}`;
}
