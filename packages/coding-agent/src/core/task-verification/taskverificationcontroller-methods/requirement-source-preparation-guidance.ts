import { REQUIREMENT_AUDIT_TOOL_NAME } from "../constants.ts";

export function formatRequirementSourcePreparationGuidance(paths: readonly string[]): string {
  return [
    "NEXT REQUIRED ACTION: freeze only the explicitly referenced task specifications before baseline setup or implementation.",
    `Candidates: ${paths.join(", ")}.`,
    "Only files listed under Candidates are requirement sources.",
    "Modules returned by read_rules are execution instructions, not requirement sources; never classify their links or clauses through source_clause_ids or ignored_source_clauses.",
    `Call ${REQUIREMENT_AUDIT_TOOL_NAME} with action "prepare_definition" next, select 0-3 relevant Candidates through selected_paths, and classify every remaining Candidate through ignored_paths with a concrete reason. Do not call define first.`,
  ].join("\n");
}
