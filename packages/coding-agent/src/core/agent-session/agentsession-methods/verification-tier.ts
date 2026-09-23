import type { TaskVerificationPolicy } from "../../task-verification/verification-policy.ts";
import { setVerificationPolicy } from "../../task-verification-tier-session.ts";
import type { AgentSession } from "../agentsession.ts";
import type { VerificationTierStatus } from "../agentsession-verification-methods.ts";

export function do_getVerificationTierStatus(self: AgentSession): VerificationTierStatus | undefined {
  const runtime = self._taskVerificationRuntime;
  if (!runtime) {
    return self._verificationPolicyOff
      ? { policy: "off", policyOverridden: false, tier: "light", reason: "default", active: false }
      : undefined;
  }
  const tier = runtime.tier;
  return {
    policy: tier.policy,
    policyOverridden: tier.policyOverridden,
    tier: tier.tier,
    reason: tier.reason,
    ...(tier.trigger ? { trigger: tier.trigger } : {}),
    active: runtime.enabled,
    ...(runtime.pendingPolicy ? { pendingPolicy: runtime.pendingPolicy } : {}),
  };
}

export function do_setVerificationPolicy(
  self: AgentSession,
  policy: TaskVerificationPolicy,
): VerificationTierStatus | undefined {
  return setVerificationPolicy(self, policy) ? do_getVerificationTierStatus(self) : undefined;
}
