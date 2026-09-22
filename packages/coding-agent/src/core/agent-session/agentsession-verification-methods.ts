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
}

export interface AgentSessionVerificationMethods {
  /** Undefined when verification is off in settings (no controller installed). */
  getVerificationTierStatus(): VerificationTierStatus | undefined;
  /** Applies a session-level policy override; undefined when verification is off in settings. */
  setVerificationPolicy(policy: TaskVerificationPolicy): VerificationTierStatus | undefined;
}
