import type { CompactionDryRunResult } from "../../../../../core/agent-session.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export async function do_handleBashCommand(
  self: InteractiveMode,
  command: string,
  excludeFromContext = false,
): Promise<void> {
  return do_handleBashCommand(self, command, excludeFromContext);
}

export function do_formatCompactionDryRun(self: InteractiveMode, result: CompactionDryRunResult): string {
  return do_formatCompactionDryRun(self, result);
}

export async function do_handleCompactCommand(
  self: InteractiveMode,
  customInstructions?: string,
  options?: { dryRun?: boolean; audit?: boolean },
): Promise<void> {
  return do_handleCompactCommand(self, customInstructions, options);
}

export function do_stop(self: InteractiveMode): void {
  do_stop(self);
}
