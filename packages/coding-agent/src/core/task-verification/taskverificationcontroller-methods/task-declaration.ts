import { baselineRequired } from "../requirement-checks.ts";
import { emptyState } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { isTaskKind, normalizeText } from "../tool-classification.ts";
import type { VerificationInput, VerificationResult } from "../types.ts";
import { requirementAuditAfterTaskDeclaration } from "./task-declaration-requirement-audit.ts";

export function declareTask(self: TaskVerificationController, input: VerificationInput): VerificationResult {
  if (!isTaskKind(input.task_kind) || !normalizeText(input.task_summary)) {
    return self.rejected("declare_task requires task_kind and a concrete task_summary.");
  }
  if (self.state.mutationRevision > 0) {
    return self.rejected("Cannot replace the task declaration after mutation; finish the current task first.");
  }
  const taskSummary = normalizeText(input.task_summary);
  const currentPrompts = self.state.taskPrompts?.length
    ? self.state.taskPrompts
    : self.latestUserPrompt.trim()
      ? [{ id: `user-${Date.now()}-1`, text: self.latestUserPrompt }]
      : [];
  const promptContext = currentPrompts.map((prompt) => prompt.text).join("\n") || self.latestUserPrompt;
  const required = baselineRequired(input.task_kind, `${promptContext}\n${taskSummary}`);
  self.rejectedRequirementDefinitionDraft = undefined;
  self.state = {
    ...emptyState(self.state.taskId, self.mode),
    taskKind: input.task_kind,
    taskSummary,
    taskContext: promptContext.slice(0, 2_000) || undefined,
    taskPrompts: currentPrompts,
    requirementSourceRefs: self.state.requirementSourceRefs ?? [],
    ignoredRequirementSources: self.state.ignoredRequirementSources ?? [],
    requirementDefinitionPolicy: self.state.requirementDefinitionPolicy,
    baseline: {
      required,
      status: required ? "pending" : "not_required",
      evidenceRefs: [],
      authorizedTestPaths: [],
      testSetupChanged: false,
    },
    requirementAudit: requirementAuditAfterTaskDeclaration(self, taskSummary, currentPrompts),
    updatedAt: new Date().toISOString(),
  };
  if (!self.restoreError?.startsWith("requirement-source snapshot")) self.restoreError = undefined;
  self.persistState();
  return self.updated(
    required
      ? "Task declared; baseline verification is required before production mutation."
      : "Task declared; final verification is required after mutation.",
  );
}
