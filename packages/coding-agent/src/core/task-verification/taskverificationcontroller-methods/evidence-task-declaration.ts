import { requestedEffectIntent } from "../requested-effect-intent.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { isTaskKind, normalizeText } from "../tool-classification.ts";
import type { EvidenceVerificationInput, VerificationResult } from "../types.ts";

export function recordEvidenceTaskDeclaration(
  self: TaskVerificationController,
  input: Pick<EvidenceVerificationInput, "task_kind" | "task_summary">,
): VerificationResult {
  if (!isTaskKind(input.task_kind) || !normalizeText(input.task_summary)) {
    return self.rejected("declare_task requires task_kind and a concrete task_summary.");
  }
  if (self.state.mutationRevision > 0) {
    return self.rejected("Cannot declare or replace task intent after a successful effect.");
  }
  if (self.state.taskKind) {
    return self.state.taskKind === input.task_kind
      ? self.updated("The current task intent is already declared.", false)
      : self.rejected("Cannot replace the same-prompt task intent declaration.");
  }
  const promptTexts = self.state.taskPrompts?.map((prompt) => prompt.text) ?? [];
  if (promptTexts.length === 0) return self.rejected("declare_task requires a current substantive user prompt.");
  const inferred = requestedEffectIntent(promptTexts);
  if (inferred === "effect_required" && input.task_kind === "investigation") {
    return self.rejected(
      "The retained user request explicitly requires an effect; investigation cannot authorize zero-effect completion.",
    );
  }
  if (inferred === "response_only" && input.task_kind !== "investigation") {
    return self.rejected("The retained user request is response-only; declare it as investigation.");
  }
  self.state = {
    ...self.state,
    taskKind: input.task_kind,
    taskSummary: normalizeText(input.task_summary),
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  return self.updated(`Task intent declared as ${input.task_kind}.`, false);
}
