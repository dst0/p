import type { TaskVerificationState, VerificationResult } from "../types.ts";

const MAX_NEXT_ACTION_CONTEXT_CHARS = 1_600;
const OVERSIZED_NEXT_ACTION_SUMMARY =
  "NEXT REQUIRED ACTION: retrieve the exact raw task-verification result before acting; its action exceeds the bounded inline context extract. Do not execute or infer a truncated command.";

export function taskVerificationContextExtract(
  nextAction: string,
  state: TaskVerificationState,
): NonNullable<VerificationResult["contextExtract"]> {
  return {
    summary: boundedNextAction(nextAction),
    relevantLines: [
      `Mutation revision: ${state.mutationRevision}`,
      `Baseline: ${state.baseline.status}`,
      `Final: ${state.final.status}`,
      `Readiness: ${state.readiness?.status ?? "pending"}`,
      `Requirement audit: ${state.requirementAudit.status}`,
    ],
  };
}

function boundedNextAction(nextAction: string): string {
  if (nextAction.length <= MAX_NEXT_ACTION_CONTEXT_CHARS) return nextAction;
  return OVERSIZED_NEXT_ACTION_SUMMARY;
}
