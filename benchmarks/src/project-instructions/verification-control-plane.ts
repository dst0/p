const TASK_VERIFICATION_CONTROL_PLANE_ACTIONS = new Set([
  "declare_task",
  "authorize_baseline_test",
  "record_baseline",
  "record_final",
  "ready_to_finish",
  "status",
]);

export function isBenchmarkProjectInstructionVerificationControlPlaneAction(toolName: string, args: unknown): boolean {
  if (toolName === "record_requirement_audit") return true;
  if (toolName !== "record_task_verification" || args === null || typeof args !== "object" || Array.isArray(args)) {
    return false;
  }
  const action = (args as { action?: unknown }).action;
  return typeof action === "string" && TASK_VERIFICATION_CONTROL_PLANE_ACTIONS.has(action);
}
