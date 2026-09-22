import type { TaskVerificationMode } from "../task-verification/mode.ts";
import type { TaskVerificationController } from "../task-verification.ts";
import type { TaskVerificationTierRuntime } from "../task-verification-tier-runtime.ts";

export interface InstalledTaskVerificationRuntime {
  configuredMode: Exclude<TaskVerificationMode, "off">;
  controller: TaskVerificationController;
  /** Controller hooks run: observing while LIGHT, enforcing while STRICT. */
  enabled: boolean;
  managedToolNames: ReadonlySet<string>;
  tier: TaskVerificationTierRuntime;
  /** Default tools deferred behind tool_search while LIGHT and restored for STRICT. */
  tierManagedToolNames: readonly string[];
  /** Task-owned paths as last seen by the tier backstop. */
  observedLedger: ReadonlySet<string>;
}
