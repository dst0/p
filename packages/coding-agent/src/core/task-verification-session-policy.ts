import { type ResolvedToolEffect, toolEffectRequiresVerification } from "@dst0/p-agent-core";
import type { TaskVerificationMode } from "./task-verification/mode.ts";
import { REQUIREMENT_AUDIT_TOOL_NAME, TASK_VERIFICATION_TOOL_NAME } from "./task-verification.ts";

export interface TaskVerificationSessionPolicyInputs {
  mode: TaskVerificationMode;
  activeToolEffects: readonly ResolvedToolEffect[];
  excludeTools?: string[];
  retainVerification?: boolean;
}

export interface TaskVerificationSessionPolicy {
  enabled: boolean;
  requiredToolNames: string[];
}

function getRequiredToolNames(mode: TaskVerificationMode): string[] {
  if (mode === "off") return [];
  return mode === "audit" ? [TASK_VERIFICATION_TOOL_NAME, REQUIREMENT_AUDIT_TOOL_NAME] : [TASK_VERIFICATION_TOOL_NAME];
}

function assertRequiredToolsAllowed(
  mode: TaskVerificationMode,
  requiredToolNames: string[],
  excludedToolNames: string[] | undefined,
): void {
  const excluded = new Set(excludedToolNames ?? []);
  const requiredExcludedTool = requiredToolNames.find((name) => excluded.has(name));
  if (requiredExcludedTool) {
    throw new Error(`Task verification mode "${mode}" requires tool "${requiredExcludedTool}"`);
  }
}

export function resolveTaskVerificationSessionPolicy(
  options: TaskVerificationSessionPolicyInputs,
): TaskVerificationSessionPolicy {
  const enabled =
    options.mode !== "off" &&
    (options.retainVerification === true || options.activeToolEffects.some(toolEffectRequiresVerification));
  const requiredToolNames = enabled ? getRequiredToolNames(options.mode) : [];
  assertRequiredToolsAllowed(options.mode, requiredToolNames, options.excludeTools);
  return { enabled, requiredToolNames };
}
