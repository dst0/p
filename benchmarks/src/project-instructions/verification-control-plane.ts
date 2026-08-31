export function isBenchmarkProjectInstructionVerificationControlPlaneAction(toolName: string, args: unknown): boolean {
  if (toolName === "record_requirement_audit") return true;
  if (toolName !== "record_task_verification" || args === null || typeof args !== "object" || Array.isArray(args)) {
    return false;
  }
  return (args as { action?: unknown }).action === "status";
}
