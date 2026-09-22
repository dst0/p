import type { TaskVerificationMode } from "./mode.ts";

/**
 * User-facing verification policy.
 *
 * - `auto`: start LIGHT and escalate to STRICT for code-and-test work.
 * - `light`: never require verification ceremony; a text answer ends the run.
 * - `strict`: always use the evidence engine with explicit `finish_work` completion.
 * - `off`: no verification controller.
 */
export const TASK_VERIFICATION_POLICIES = ["auto", "light", "strict", "off"] as const;
export type TaskVerificationPolicy = (typeof TASK_VERIFICATION_POLICIES)[number];
export const DEFAULT_TASK_VERIFICATION_POLICY: TaskVerificationPolicy = "auto";

/** Evidence engine used by the STRICT tier. */
export const TASK_VERIFICATION_ENGINES = ["evidence", "audit"] as const;
export type TaskVerificationEngine = (typeof TASK_VERIFICATION_ENGINES)[number];
export const DEFAULT_TASK_VERIFICATION_ENGINE: TaskVerificationEngine = "evidence";

/** CLI and SDK selection: a policy, or an engine name that forces STRICT with that engine. */
export const TASK_VERIFICATION_SELECTIONS = [...TASK_VERIFICATION_POLICIES, ...TASK_VERIFICATION_ENGINES] as const;
export type TaskVerificationSelection = (typeof TASK_VERIFICATION_SELECTIONS)[number];

/** Persisted `taskVerification` settings block. */
export interface TaskVerificationSettings {
  mode?: TaskVerificationPolicy;
  engine?: TaskVerificationEngine;
}

export interface TaskVerificationConfiguration {
  policy: TaskVerificationPolicy;
  engine: TaskVerificationEngine;
}

export const DEFAULT_TASK_VERIFICATION_CONFIGURATION: TaskVerificationConfiguration = {
  policy: DEFAULT_TASK_VERIFICATION_POLICY,
  engine: DEFAULT_TASK_VERIFICATION_ENGINE,
};

export function isTaskVerificationPolicy(value: unknown): value is TaskVerificationPolicy {
  return typeof value === "string" && (TASK_VERIFICATION_POLICIES as readonly string[]).includes(value);
}

export function isTaskVerificationEngine(value: unknown): value is TaskVerificationEngine {
  return typeof value === "string" && (TASK_VERIFICATION_ENGINES as readonly string[]).includes(value);
}

export function isTaskVerificationSelection(value: unknown): value is TaskVerificationSelection {
  return isTaskVerificationPolicy(value) || isTaskVerificationEngine(value);
}

/** Reads a persisted settings block, falling back field by field to the defaults. */
export function taskVerificationConfigurationFromSettings(settings: unknown): TaskVerificationConfiguration {
  const record = typeof settings === "object" && settings !== null ? (settings as Record<string, unknown>) : {};
  return {
    policy: isTaskVerificationPolicy(record.mode) ? record.mode : DEFAULT_TASK_VERIFICATION_POLICY,
    engine: isTaskVerificationEngine(record.engine) ? record.engine : DEFAULT_TASK_VERIFICATION_ENGINE,
  };
}

/** Applies an explicit CLI or SDK selection on top of the configured settings. */
export function resolveTaskVerificationConfiguration(
  selection: TaskVerificationSelection | undefined,
  configured: TaskVerificationConfiguration,
): TaskVerificationConfiguration {
  if (selection === undefined) return configured;
  if (isTaskVerificationEngine(selection)) return { policy: "strict", engine: selection };
  return { policy: selection, engine: configured.engine };
}

/** The controller engine mode for a configuration; `off` disables the controller. */
export function taskVerificationEngineMode(configuration: TaskVerificationConfiguration): TaskVerificationMode {
  return configuration.policy === "off" ? "off" : configuration.engine;
}

/**
 * Migrates the legacy global `taskVerificationMode` setting:
 * evidence → strict, audit → strict with the audit engine, off → off.
 */
export function migrateLegacyTaskVerificationMode(value: unknown): TaskVerificationSettings | undefined {
  if (value === "evidence") return { mode: "strict", engine: "evidence" };
  if (value === "audit") return { mode: "strict", engine: "audit" };
  if (value === "off") return { mode: "off" };
  return undefined;
}
