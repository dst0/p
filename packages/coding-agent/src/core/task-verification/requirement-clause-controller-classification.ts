import { isUnsafeDelegatedInstruction, type RequirementSourceClause } from "./requirement-source-clauses.ts";
import type { IgnoredSourceClause } from "./types.ts";

export function controllerIgnoredSourceClause(clause: RequirementSourceClause): IgnoredSourceClause | undefined {
  if (isUnsafeDelegatedInstruction(clause.text)) {
    return {
      sourceClauseId: clause.id,
      classification: "unsafe_instruction",
      reason: "Controller detected an unsafe delegated instruction.",
    };
  }
  if (clause.kind === "heading") {
    return {
      sourceClauseId: clause.id,
      classification: "informational",
      reason: "Controller classified a non-normative heading.",
    };
  }
  return undefined;
}
