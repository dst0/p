import type { CompletionMode, CompletionProtocolLimits } from "@dst0/p-agent-core";
import type { TaskVerificationMode } from "./task-verification/mode.ts";

export interface AgentSessionPolicyOptions {
  /** Completion protocol. Defaults to settings, then explicit_finish. */
  completionMode?: CompletionMode;
  /** Task verification policy. Defaults to settings, then evidence. */
  taskVerificationMode?: TaskVerificationMode;
  /** Safety limits for explicit and hybrid completion modes. */
  completionLimits?: CompletionProtocolLimits;
}
