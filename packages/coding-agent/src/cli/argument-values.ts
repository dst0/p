import type { CompletionMode, ThinkingLevel } from "@dst0/p-agent-core";
import type { ProjectInstructionDeliveryMode } from "../core/project-instructions/index.ts";
import {
  isTaskVerificationMode,
  TASK_VERIFICATION_MODES,
  type TaskVerificationMode,
} from "../core/task-verification/mode.ts";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const COMPLETION_MODE_ALIASES = {
  implicit: "implicit",
  explicit: "explicit_finish",
  explicit_finish: "explicit_finish",
  hybrid: "hybrid",
} satisfies Record<string, CompletionMode>;

export const COMPLETION_MODE_LABELS = ["implicit", "explicit", "explicit_finish", "hybrid"] as const;
export const PROJECT_INSTRUCTION_MODES = ["compiled", "legacy", "off"] as const;
export { isTaskVerificationMode, TASK_VERIFICATION_MODES };
export type { ProjectInstructionDeliveryMode, TaskVerificationMode };

export function isValidThinkingLevel(level: string): level is ThinkingLevel {
  return THINKING_LEVELS.includes(level as ThinkingLevel);
}

export function parseCompletionMode(mode: string): CompletionMode | undefined {
  return mode in COMPLETION_MODE_ALIASES
    ? COMPLETION_MODE_ALIASES[mode as keyof typeof COMPLETION_MODE_ALIASES]
    : undefined;
}

export function isProjectInstructionMode(value: string): value is ProjectInstructionDeliveryMode {
  return PROJECT_INSTRUCTION_MODES.includes(value as ProjectInstructionDeliveryMode);
}

export function parsePositiveIntegerFlag(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
