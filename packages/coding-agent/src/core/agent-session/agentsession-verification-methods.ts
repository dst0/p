import type { VerificationTier, VerificationTierReason } from "../task-verification/task-tier.ts";
import type { TaskVerificationPolicy } from "../task-verification/verification-policy.ts";

/** Current adaptive-verification state for UI and commands. */
export interface VerificationTierStatus {
  policy: TaskVerificationPolicy;
  /** True when a session `/verify` override replaced the configured policy. */
  policyOverridden: boolean;
  tier: VerificationTier;
  reason: VerificationTierReason;
  trigger?: string;
  /** False when nothing is verified: policy `off`, or no active tool can change anything. */
  active: boolean;
  /** An override requested mid-run that applies at the next turn boundary. */
  pendingPolicy?: TaskVerificationPolicy;
}

export interface AgentSessionVerificationMethods {
  /** Undefined only for sessions created without a verification configuration. */
  getVerificationTierStatus(): VerificationTierStatus | undefined;
  /**
   * Applies a session-level policy override (queued to the next turn boundary while a run streams);
   * undefined when verification is off in settings and no controller exists.
   */
  setVerificationPolicy(policy: TaskVerificationPolicy): VerificationTierStatus | undefined;
}
