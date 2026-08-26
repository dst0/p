import type { TaskVerificationState } from "./types.ts";

export function requirementDefinitionPolicyActive(state: TaskVerificationState): boolean {
  if (state.requirementDefinitionPolicy === 1) return true;
  if (state.mutationRevision !== 0) return false;
  return (
    (state.taskPrompts?.length ?? 0) > 0 ||
    Boolean(state.taskContext?.trim()) ||
    (state.requirementSourceRefs?.length ?? 0) > 0 ||
    (state.ignoredRequirementSources?.length ?? 0) > 0
  );
}
