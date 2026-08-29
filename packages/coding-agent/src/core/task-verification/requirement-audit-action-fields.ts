import type { RequirementAuditInput } from "./types.ts";

type RequirementAuditAction = RequirementAuditInput["action"];

const ACTION_FIELDS: Record<RequirementAuditAction, readonly (keyof RequirementAuditInput)[]> = {
  prepare_definition: ["action", "selected_paths", "adopt_changed_paths", "ignored_paths"],
  define: ["action", "requirements", "ignored_source_prompts", "ignored_source_clauses"],
  repair_definition: [
    "action",
    "definition_revision",
    "requirement_repairs",
    "ignored_source_prompt_upserts",
    "ignored_source_prompt_removals",
    "ignored_source_clause_upserts",
    "ignored_source_clause_removals",
  ],
  verdict: ["action", "verdicts"],
};

export function requirementAuditForeignFieldError(input: RequirementAuditInput): string | undefined {
  const allowed = new Set<string>(ACTION_FIELDS[input.action]);
  const foreign = Object.keys(input).filter((field) => !allowed.has(field));
  if (foreign.length === 0) return undefined;
  return `${input.action} does not accept field(s): ${foreign.join(", ")}.`;
}
