export const TASK_VERIFICATION_MODES = ["evidence", "audit", "off"] as const;

export type TaskVerificationMode = (typeof TASK_VERIFICATION_MODES)[number];

export const DEFAULT_TASK_VERIFICATION_MODE: TaskVerificationMode = "evidence";

export function isTaskVerificationMode(value: unknown): value is TaskVerificationMode {
  return typeof value === "string" && (TASK_VERIFICATION_MODES as readonly string[]).includes(value);
}
