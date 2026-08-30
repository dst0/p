import type { BeforeToolCallResult } from "@dst0/p-agent-core";
import { TASK_VERIFICATION_TOOL_NAME } from "../constants.ts";
import { inferTaskKind } from "../task-kind-inference.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { normalizeText } from "../tool-classification.ts";

export function automaticTaskDeclarationGate(self: TaskVerificationController): BeforeToolCallResult | undefined {
  const taskText =
    self.state.taskPrompts
      ?.map((prompt) => prompt.text)
      .join("\n")
      .trim() || self.latestUserPrompt;
  const taskSummary = normalizeText(taskText).slice(0, 500) || "Implement the requested workspace change.";
  const taskKind = inferTaskKind(taskText);
  if (!taskKind) {
    return self.blocked(
      [
        "Task classification is ambiguous; no mutation was performed.",
        `Call ${TASK_VERIFICATION_TOOL_NAME} once with the dominant requested effect, then retry the mutation:`,
        '{"action":"declare_task","task_kind":"<bug_fix|behavior_change|refactor|feature|docs|investigation>","task_summary":"<dominant requested effect>"}',
      ].join("\n"),
    );
  }
  const declaration = self.declareTask({ action: "declare_task", task_kind: taskKind, task_summary: taskSummary });
  if (declaration.status !== "updated" || !self.state.taskKind) return self.blocked(declaration.message);
  return undefined;
}
