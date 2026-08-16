import { createHash } from "node:crypto";
import type {
  IgnoredSourcePrompt,
  TaskRequirement,
  TaskVerificationSourcePrompt,
  TaskVerificationState,
} from "./types.ts";

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function sourcePromptsForState(state: TaskVerificationState): TaskVerificationSourcePrompt[] {
  if (state.taskPrompts && state.taskPrompts.length > 0) return state.taskPrompts;
  if (state.taskSummary) return [{ id: "task-summary", text: state.taskSummary }];
  return [];
}

export function computeUserRequirementsHash(prompts: readonly TaskVerificationSourcePrompt[]): string {
  return sha256(prompts.map((prompt) => ({ id: prompt.id, text: prompt.text })));
}

export function computeRequirementSetHash(
  requirements: readonly TaskRequirement[],
  ignoredSourcePrompts: readonly IgnoredSourcePrompt[],
): string {
  return sha256({
    requirements: requirements.map((requirement) => ({
      id: requirement.id,
      type: requirement.type,
      text: requirement.text,
      acceptanceCriterion: requirement.acceptanceCriterion,
      sourcePromptIndexes: requirement.sourcePromptIndexes,
    })),
    ignoredSourcePrompts,
  });
}

export function computeCertificateHash(
  taskId: string,
  mutationRevision: number,
  userRequirementsHash: string,
  requirementSetHash: string,
): string {
  return sha256({ taskId, mutationRevision, userRequirementsHash, requirementSetHash });
}
