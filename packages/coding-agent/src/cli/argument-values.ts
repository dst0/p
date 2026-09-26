import type { CompletionMode, ThinkingLevel } from "@dst0/p-agent-core";
import { MAX_PROJECT_INSTRUCTION_STARTUP_DEADLINE_SECONDS } from "../core/project-instructions/compiler-runner.ts";
import type { ProjectInstructionDeliveryMode } from "../core/project-instructions/index.ts";
import {
  isTaskVerificationSelection,
  TASK_VERIFICATION_SELECTIONS,
  type TaskVerificationSelection,
} from "../core/task-verification/verification-policy.ts";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const COMPLETION_MODE_ALIASES = {
  implicit: "implicit",
  explicit: "explicit_finish",
  explicit_finish: "explicit_finish",
  hybrid: "hybrid",
} satisfies Record<string, CompletionMode>;

export const COMPLETION_MODE_LABELS = ["implicit", "explicit", "explicit_finish", "hybrid"] as const;
export const PROJECT_INSTRUCTION_MODES = ["compiled", "legacy", "off"] as const;
export { isTaskVerificationSelection, TASK_VERIFICATION_SELECTIONS };
export type { ProjectInstructionDeliveryMode, TaskVerificationSelection };

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

export const DEFAULT_PROJECT_INSTRUCTION_STARTUP_DEADLINE_SECONDS = 12;

export function parseNonNegativeIntegerFlag(value: string): number | undefined {
  if (!/^(0|[1-9]\d*)$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= MAX_PROJECT_INSTRUCTION_STARTUP_DEADLINE_SECONDS
    ? parsed
    : undefined;
}
