import type { TaskVerificationSourcePrompt } from "./types.ts";

export function validateReferencedSourceMappings(
  requirementIndex: number,
  prompts: readonly TaskVerificationSourcePrompt[],
  explicitSourcePromptIndexes: readonly number[],
  diagnostics: string[],
): void {
  for (const promptIndex of explicitSourcePromptIndexes) {
    if (prompts[promptIndex - 1]?.kind !== "referenced_file") continue;
    diagnostics.push(
      `Requirement ${requirementIndex + 1} includes referenced-file source index ${promptIndex}, but source_prompt_indexes is direct-only; remove index ${promptIndex} and map the referenced requirement through source_clause_ids or source_facet_ids.`,
    );
  }
}
