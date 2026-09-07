import type { BeforeToolCallResult, ResolvedToolEffect } from "@dst0/p-agent-core";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";

export function unknownEffectGate(
  self: TaskVerificationController,
  effect: ResolvedToolEffect,
  toolName: string,
): BeforeToolCallResult | undefined {
  if (effect.kind !== "unknown" || !hasCompletionEvidence(self)) return undefined;
  return self.blocked(
    `Cannot run ${toolName} after completion evidence was recorded because the tool has no declared effect. ` +
      "Use a tool with an explicit read, workspace_write, or external_write effect, or update the tool declaration before retrying. " +
      "The completed evidence was preserved.",
  );
}

function hasCompletionEvidence(self: TaskVerificationController): boolean {
  return (
    self.state.final.status === "passed" ||
    (self.state.readiness?.status ?? "pending") !== "pending" ||
    self.state.requirementAudit.status === "passed"
  );
}
