import { type CompletionMode, FINISH_WORK_TOOL_NAME } from "@dst0/p-agent-core";

export function formatCompletionProtocolInstructions(mode: CompletionMode | undefined): string {
  const sessionStateInstructions = [
    `Before calling \`${FINISH_WORK_TOOL_NAME}\`, reconcile the visible working state.`,
    "Examine the <working_state> block to check current plan items and their statuses.",
    "Call finish_work with status 'success' only when the requested work is genuinely complete. For code changes when task verification is active, call record_task_verification with action 'ready_to_finish' before calling finish_work.",
    "A successful call automatically reconciles stale not_started or in_progress plan statuses; failed or blocked items must be resolved, or reported with status 'partial'/'failed' and remaining_work.",
    "A next action must be a specific unfinished action; never use completed or status-only entries such as `Done`, `Complete`, or `All done`. Record completed work as progress, and leave next actions empty when no work remains.",
    "Use `initial_plan` only for a fresh task with no active plan; otherwise use `replan` to replace the complete current plan.",
    `If \`${FINISH_WORK_TOOL_NAME}\` is rejected for unresolved state or unverified code changes, do not retry it unchanged: complete readiness or update state, or finish as partial/failed with remaining work.`,
    "Use session-state tools to update that state. Never edit `.pdev` state or snapshot files directly; they do not update the running session.",
  ].join(" ");

  if (mode === "explicit_finish") {
    return [
      "You are operating in explicit completion mode.",
      `You must not end the task with a normal assistant message. When the task is complete, call \`${FINISH_WORK_TOOL_NAME}\`.`,
      "If more work is needed, call tools.",
      `If you encounter an unrecoverable problem, call \`${FINISH_WORK_TOOL_NAME}\` with status \`failed\` or \`partial\` and explain the remaining issue.`,
      sessionStateInstructions,
    ].join("\n");
  }

  if (mode === "hybrid") {
    return [
      "You are operating in hybrid completion mode.",
      `Prefer calling \`${FINISH_WORK_TOOL_NAME}\` when the task is complete instead of ending with a normal assistant message.`,
      "If more work is needed, call tools.",
      `If you encounter an unrecoverable problem, call \`${FINISH_WORK_TOOL_NAME}\` with status \`failed\` or \`partial\` and explain the remaining issue.`,
      sessionStateInstructions,
    ].join("\n");
  }

  return "";
}
