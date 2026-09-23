import type { CompletionMode, CompletionProtocolLimits } from "@dst0/p-agent-core";
import type { TaskVerificationSelection } from "./task-verification/verification-policy.ts";

export interface AgentSessionPolicyOptions {
  /** Completion protocol. Defaults to settings, then explicit_finish. */
  completionMode?: CompletionMode;
  /**
   * Task verification policy: auto, light, strict, or off. `evidence` and `audit` force strict with
   * that engine. Defaults to the global `taskVerification` setting, then auto.
   */
  taskVerificationMode?: TaskVerificationSelection;
  /** Safety limits for explicit and hybrid completion modes. */
  completionLimits?: CompletionProtocolLimits;
}
