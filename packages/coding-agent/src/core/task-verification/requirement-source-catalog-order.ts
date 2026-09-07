import type { TaskVerificationSourcePrompt } from "./types.ts";

export interface AnchoredRequirementDefinitionSource {
  promptCount: number;
  source: TaskVerificationSourcePrompt;
}

export function orderRequirementDefinitionSources(
  prompts: readonly TaskVerificationSourcePrompt[],
  referenced: readonly AnchoredRequirementDefinitionSource[],
): TaskVerificationSourcePrompt[] {
  const emitted = new Set<number>();
  const ordered: TaskVerificationSourcePrompt[] = [];
  for (const [promptIndex, prompt] of prompts.entries()) {
    ordered.push(prompt);
    for (const [referenceIndex, reference] of referenced.entries()) {
      if (reference.promptCount !== promptIndex + 1) continue;
      ordered.push(reference.source);
      emitted.add(referenceIndex);
    }
  }
  for (const [referenceIndex, reference] of referenced.entries()) {
    if (!emitted.has(referenceIndex)) ordered.push(reference.source);
  }
  return ordered;
}
