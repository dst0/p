import type { BeforeToolCallResult } from "@dst0/p-agent-core";
import { completionVerificationScope } from "../completion-verification-scope.ts";
import { frozenSourceOutputRestoreError } from "../critical-proof-source-output-revalidation.ts";
import { revalidateCriticalProofSources } from "../evidence-critical-proof-observation.ts";
import { requestedEffectIntent } from "../requested-effect-intent.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { normalizedFilesChanged } from "../workspace-effect-state.ts";
import { currentCompletionChecklist } from "./completion-checklist.ts";

export function zeroEffectCompletionGate(
  self: TaskVerificationController,
  action: string,
  verificationToken: string | undefined,
  filesChanged: unknown,
): BeforeToolCallResult | undefined {
  const checklist = currentCompletionChecklist(self);
  if (typeof checklist === "string") {
    return self.blocked(
      `Cannot ${action}: ${checklist}. For a response-only task, record the current checklist with verification_scope "response_only"; otherwise perform the requested effect before completion.`,
    );
  }
  const sourceError = frozenSourceOutputRestoreError(self) ?? revalidateCriticalProofSources(self);
  if (sourceError) return self.blocked(`Cannot ${action}: ${sourceError}`);
  if (completionVerificationScope(checklist) !== "response_only") {
    return self.blocked(
      `Cannot ${action}: ${completionVerificationScope(checklist)} completion requires at least one successful effect.`,
    );
  }
  const promptTexts = self.state.taskPrompts?.map((prompt) => prompt.text) ?? [self.latestUserPrompt];
  const intent = requestedEffectIntent(promptTexts);
  if (intent === "effect_required" || (intent === "unknown" && self.state.taskKind !== "investigation")) {
    if (intent === "unknown" && !self.state.taskKind) {
      return self.blocked(
        `Cannot ${action}: requested effect is not classified. Call record_task_verification once with {"action":"declare_task","task_kind":"<bug_fix|behavior_change|refactor|feature|docs|investigation>","task_summary":"<dominant requested effect>"}, then retry.`,
      );
    }
    return self.blocked(`Cannot ${action}: the requested task requires at least one successful effect.`);
  }
  if (verificationToken !== undefined) {
    return self.blocked(`Cannot ${action}: zero-effect response-only completion has no verification_token.`);
  }
  const normalized = filesChanged === undefined ? [] : normalizedFilesChanged(filesChanged);
  if (!normalized || normalized.length > 0) {
    return self.blocked(`Cannot ${action}: files_changed must be empty when no workspace effect was recorded.`);
  }
  return undefined;
}
