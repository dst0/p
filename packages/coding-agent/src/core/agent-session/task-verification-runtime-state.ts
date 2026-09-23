import type { TaskVerificationMode } from "../task-verification/mode.ts";
import type { TaskVerificationPolicy } from "../task-verification/verification-policy.ts";
import type { TaskVerificationController } from "../task-verification.ts";
import type { TaskVerificationTierRuntime } from "../task-verification-tier-runtime.ts";

export interface InstalledTaskVerificationRuntime {
  configuredMode: Exclude<TaskVerificationMode, "off">;
  controller: TaskVerificationController;
  /** Controller hooks run: observing while LIGHT, enforcing while STRICT. */
  enabled: boolean;
  managedToolNames: ReadonlySet<string>;
  tier: TaskVerificationTierRuntime;
  /** An explicitly configured completion mode is kept when verification is not engaged. */
  completionModeExplicit: boolean;
  /** Default tools deferred behind tool_search while LIGHT and restored for STRICT. */
  tierManagedToolNames: readonly string[];
  /** Ledger as last seen by the tier backstop. */
  observedLedger: ObservedVerificationLedger;
  /** A policy override requested mid-run, applied at the next turn boundary. */
  pendingPolicy?: TaskVerificationPolicy;
}

export interface ObservedVerificationLedger {
  ownedPaths: ReadonlySet<string>;
  sourcePaths: ReadonlySet<string>;
  mutationRevision: number;
}
