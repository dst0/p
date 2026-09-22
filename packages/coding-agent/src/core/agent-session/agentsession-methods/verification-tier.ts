import type { TaskVerificationPolicy } from "../../task-verification/verification-policy.ts";
import { setVerificationPolicy } from "../../task-verification-tier-session.ts";
import type { AgentSession } from "../agentsession.ts";
import type { VerificationTierStatus } from "../agentsession-verification-methods.ts";

export function do_getVerificationTierStatus(self: AgentSession): VerificationTierStatus | undefined {
  const tier = self._taskVerificationRuntime?.tier;
  if (!tier) return undefined;
  return {
    policy: tier.policy,
    policyOverridden: tier.policyOverridden,
    tier: tier.tier,
    reason: tier.reason,
    ...(tier.trigger ? { trigger: tier.trigger } : {}),
  };
}

export function do_setVerificationPolicy(
  self: AgentSession,
  policy: TaskVerificationPolicy,
): VerificationTierStatus | undefined {
  return setVerificationPolicy(self, policy) ? do_getVerificationTierStatus(self) : undefined;
}
